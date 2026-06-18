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
        if (!/^https:\/\/www\.gutenberg\.org\//.test(bookUrl)) {
          res.statusCode = 400;
          res.end('bad url');
          return;
        }

        try {
          const upstream = await fetch(bookUrl, {
            headers: { 'User-Agent': 'vishvaddi-reader/1.0' },
            signal: AbortSignal.timeout(20000),
          });
          if (!upstream.ok) {
            res.statusCode = 502;
            res.end('upstream error');
            return;
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(Buffer.from(await upstream.arrayBuffer()));
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
    },
  };
}

// https://astro.build/config
export default defineConfig({
  site: 'https://vishvaddi.com',
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss(), localBookProxy()],
    // Never inline client scripts. The strict CSP (script-src 'self' + a couple
    // of hashes, no 'unsafe-inline') blocks inline <script type="module">, which
    // silently broke small scripts like the planting calendar. Forcing them
    // external keeps them covered by 'self'.
    build: { assetsInlineLimit: 0 },
  },
});
