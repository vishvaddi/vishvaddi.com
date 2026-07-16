// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

/** @returns {import('vite').Plugin} */
function localBookProxy() {
  return {
    name: 'local-book-proxy',
    configureServer(server) {
      const decodeHtml = (raw) => raw
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

      const textMatch = (source, pattern) => {
        const match = source.match(pattern);
        return match?.[1] ? decodeHtml(match[1].trim()) : '';
      };

      const parseOpds = (xml) => {
        return xml.split(/<entry>/i).slice(1).map((entry) => {
          const idUrl = textMatch(entry, /<id>([^<]+)<\/id>/i);
          const idMatch = idUrl.match(/\/ebooks\/(\d+)/);
          const id = idMatch?.[1];
          if (!id) return null;
          const title = textMatch(entry, /<title>([^<]+)<\/title>/i);
          const author = textMatch(entry, /<author>[\s\S]*?<name>([^<]+)<\/name>/i);
          return {
            id: Number(id),
            title: title || `eBook ${id}`,
            authors: author ? [{ name: author }] : [],
            formats: {
              'image/jpeg': `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`,
              'text/plain; charset=utf-8': `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`,
            },
          };
        }).filter(Boolean);
      };

      const htmlToReadableText = (html) => decodeHtml((html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html)
        .replace(/<head[\s\S]*?<\/head>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<header[\s\S]*?<\/header>/gi, ' ')
        .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
        .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|blockquote|tr|section)>/gi, '\n\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim());

      const parseStandardEbooksList = (html, base = 'https://standardebooks.org') => {
        return html.split(/<li[^>]+typeof="schema:Book"[^>]*>/i).slice(1).map((entry) => {
          const about = textMatch(entry, /about="([^"]+)"/i);
          const path = about || textMatch(entry, /<a[^>]+href="(\/ebooks\/[^"]+)"[^>]+property="schema:url"/i);
          if (!/^\/ebooks\/[^?#]+$/.test(path)) return null;
          const title = textMatch(entry, /<span[^>]+property="schema:name"[^>]*>([^<]+)<\/span>/i);
          const authorBlock = entry.match(/<p[^>]+class="author"[\s\S]*?<\/p>/i)?.[0] || '';
          const author = textMatch(authorBlock, /<span[^>]+property="schema:name"[^>]*>([^<]+)<\/span>/i);
          const coverPath = textMatch(entry, /<img[^>]+src="([^"]+)"/i);
          return {
            id: path.replace(/^\/ebooks\//, ''),
            title: title || path.split('/').pop()?.replace(/-/g, ' ') || 'Standard Ebook',
            author: author || 'Unknown',
            url: new URL(path, base).toString(),
            textUrl: new URL(`${path}/text/single-page`, base).toString(),
            cover: coverPath ? new URL(coverPath, base).toString() : '',
          };
        }).filter(Boolean);
      };

      const standardEbooksNext = (html, base) => {
        const next = textMatch(html, /<a[^>]+href="([^"]+)"[^>]*>\s*Next/i);
        if (!next) return null;
        const nextUrl = new URL(next, base);
        return nextUrl.hostname === 'standardebooks.org' && nextUrl.pathname === '/ebooks' ? nextUrl.toString() : null;
      };

      const fetchOpdsPage = async (target) => {
        const upstream = await fetch(target, {
          headers: {
            'User-Agent': 'vishvaddi-reader/1.0',
            'Accept': 'application/atom+xml, application/xml, text/xml, text/plain;q=0.8',
          },
          signal: AbortSignal.timeout(20000),
        });
        if (!upstream.ok) throw new Error('upstream error');
        const xml = await upstream.text();
        const next = xml.match(/<link[^>]+rel="next"[^>]+href="([^"]+)"/i)?.[1] || null;
        return {
          items: parseOpds(xml),
          next: next ? new URL(decodeHtml(next), target).toString() : null,
        };
      };

      server.middlewares.use('/api/book', async (req, res) => {
        const url = new URL(req.url || '', 'http://localhost');
        const bookUrl = url.searchParams.get('url') || '';
        let target;
        try {
          target = new URL(bookUrl);
        } catch {
          res.statusCode = 400;
          res.end('bad url');
          return;
        }
        const isGutenberg = target.protocol === 'https:' && (target.hostname === 'www.gutenberg.org' || target.hostname === 'gutenberg.org');
        const isStandardEbooks = target.protocol === 'https:' && target.hostname === 'standardebooks.org' && /^\/ebooks\/[^?#]+\/text\/single-page$/.test(target.pathname);
        if (!isGutenberg && !isStandardEbooks) {
          res.statusCode = 400;
          res.end('bad url');
          return;
        }

        try {
          const upstream = await fetch(target, {
            headers: {
              'User-Agent': 'vishvaddi-reader/1.0',
              'Accept': isStandardEbooks ? 'application/xhtml+xml,text/html' : 'text/plain',
            },
            signal: AbortSignal.timeout(20000),
          });
          if (!upstream.ok) {
            res.statusCode = 502;
            res.end('upstream error');
            return;
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(isStandardEbooks ? htmlToReadableText(await upstream.text()) : Buffer.from(await upstream.arrayBuffer()));
        } catch {
          res.statusCode = 504;
          res.end('fetch failed');
        }
      });

      server.middlewares.use('/api/gutenberg-opds', async (req, res) => {
        const url = new URL(req.url || '', 'http://localhost');
        const query = (url.searchParams.get('query') || '').trim();
        const sortOrder = (url.searchParams.get('sort_order') || 'downloads').trim() || 'downloads';
        const startIndex = Math.max(1, parseInt(url.searchParams.get('start_index') || '1', 10) || 1);
        const opds = new URL('https://www.gutenberg.org/ebooks/search.opds/');
        if (query) opds.searchParams.set('query', query);
        opds.searchParams.set('sort_order', sortOrder);
        opds.searchParams.set('start_index', String(startIndex));

        try {
          const results = [];
          let next = opds.toString();
          let pages = 0;
          while (next && results.length < 100 && pages < 4) {
            const page = await fetchOpdsPage(next);
            results.push(...page.items);
            next = page.next;
            pages++;
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ results: results.slice(0, 100), next }));
        } catch {
          res.statusCode = 504;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ results: [] }));
        }
      });

      server.middlewares.use('/api/standardebooks', async (req, res) => {
        const url = new URL(req.url || '', 'http://localhost');
        const query = (url.searchParams.get('query') || '').trim();
        const cursor = url.searchParams.get('cursor');
        let target;
        if (cursor) {
          try {
            target = new URL(cursor);
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ results: [], next: null }));
            return;
          }
          if (target.hostname !== 'standardebooks.org' || target.pathname !== '/ebooks') {
            res.statusCode = 400;
            res.end(JSON.stringify({ results: [], next: null }));
            return;
          }
        } else {
          target = new URL('https://standardebooks.org/ebooks');
          if (query) target.searchParams.set('query', query);
        }

        try {
          const upstream = await fetch(target, {
            headers: {
              'User-Agent': 'vishvaddi-reader/1.0',
              'Accept': 'application/xhtml+xml,text/html',
            },
            signal: AbortSignal.timeout(15000),
          });
          if (!upstream.ok) throw new Error('upstream error');
          const html = await upstream.text();
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            results: parseStandardEbooksList(html, target.toString()),
            next: standardEbooksNext(html, target.toString()),
          }));
        } catch {
          res.statusCode = 504;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ results: [], next: null }));
        }
      });
    },
  };
}

// https://astro.build/config
export default defineConfig({
  site: 'https://vishvaddi.com',
  // /site/lattice is deliberately unlisted — reachable only by direct URL
  integrations: [sitemap({ filter: (page) => !page.includes('/site/lattice') })],
  vite: {
    plugins: [tailwindcss(), localBookProxy()],
    // Never inline client scripts. The strict CSP (script-src 'self' + a couple
    // of hashes, no 'unsafe-inline') blocks inline <script type="module">, which
    // silently broke small scripts like the planting calendar. Forcing them
    // external keeps them covered by 'self'.
    build: { assetsInlineLimit: 0 },
  },
});
