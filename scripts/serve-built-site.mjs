import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.wav': 'audio/wav' }

export async function serveBuiltSite(port) {
  const root = resolve('dist')
  const base = `http://127.0.0.1:${port}`
  const server = createServer(async (request, response) => {
    try {
      let target = resolve(root, `.${decodeURIComponent(new URL(request.url ?? '/', base).pathname)}`)
      if (!target.startsWith(root)) throw new Error('Invalid path')
      if ((await stat(target)).isDirectory()) target = resolve(target, 'index.html')
      response.writeHead(200, { 'Content-Type': mime[extname(target)] ?? 'application/octet-stream' })
      response.end(await readFile(target))
    } catch { response.writeHead(404); response.end('Not found') }
  })
  await new Promise((resolveListen) => server.listen(port, '127.0.0.1', resolveListen))
  return { base, close: () => new Promise((resolveClose) => server.close(resolveClose)) }
}
