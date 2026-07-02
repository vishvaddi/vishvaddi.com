# vishvaddi.com

Personal + professional site of Vish Vaddi — estimator in Sydney pricing premium retail and commercial fit-out.

**Live:** https://vishvaddi.com

## Stack

- Astro 6 + Tailwind v4, vanilla TypeScript in `<script>` tags — no framework components
- Cloudflare Workers (static assets + `worker/index.ts` API proxies)
- Content collections in `src/content/` (notes, pages, years)

## Develop

```sh
npm install
npm run dev        # localhost:4321
```

## Deploy

Manual — pushing does not deploy.

```sh
npm run build && npx wrangler deploy
```

See `CLAUDE.md` for project conventions and structure.
