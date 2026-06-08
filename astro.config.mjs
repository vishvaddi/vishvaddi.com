// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

/** @returns {import('vite').Plugin} */
function localBookProxy() {
  return {
    name: 'local-book-proxy',
    configureServer(server) {
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
    },
  };
}

// https://astro.build/config
export default defineConfig({
  site: 'https://vishvaddi.com',
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss(), localBookProxy()],
  },
});
