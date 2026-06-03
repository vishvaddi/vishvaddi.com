# vishvaddi-votes

Isolated Cloudflare Worker backing the "vote on the next tool" widget on
`/site/roadmap`. Separate from the static site — it has its own deployment and
cannot affect the site's security surface.

**Design**
- Stores only a per-option counter (`count:<option>`) and a short-lived
  hashed-IP dedupe key (`seen:<day>:<option>:<sha256(ip)>`, 36h TTL). No PII.
- CORS locked to `https://vishvaddi.com`. Votes (POST) require that Origin.
- Input validated against a fixed `OPTIONS` set — unknown options are rejected.
- One vote per option per IP per day.

**Deploy (needs your Cloudflare auth — I can't do this part):**
```sh
cd workers/votes
wrangler kv namespace create VOTES      # copy the id into wrangler.jsonc
wrangler deploy                          # prints the worker URL
```
Then in the site:
1. Set `ENDPOINT` in `src/pages/site/roadmap.astro` to
   `https://<your-worker-url>/api/votes`.
2. Add that origin to `connect-src` in `public/_headers` CSP.
3. Rebuild + push.

Until deployed, the roadmap page works fine — it shows the candidate tools and
falls back to an email suggestion instead of live voting.

**Note:** KV counter increments are not atomic; fine for low traffic. For high
concurrency, switch the counter to a Durable Object.
