import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AstroIntegration } from 'astro'
import { handlePlaylists } from '../api/playlists.js'

const ROUTE = '/api/playlists'

/** 本地 dev 与 Vercel 共用处理函数；运行时接口不受站点 base 影响。 */
export function playlistsEndpointIntegration(): AstroIntegration {
  return {
    name: 'playlists-endpoint',
    hooks: {
      'astro:config:setup': ({ command, updateConfig }) => {
        if (command !== 'dev') return
        updateConfig({
          vite: {
            plugins: [
              {
                name: 'playlists-endpoint',
                apply: 'serve',
                configureServer(server) {
                  server.middlewares.use((request, response, next) => {
                    const url = new URL(request.url ?? '/', 'http://dev')
                    if (url.pathname !== ROUTE) return next()
                    void respond(request, response, url)
                  })
                },
              },
            ],
          },
        })
      },
    },
  }
}

async function respond(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
) {
  let result
  try {
    result = await handlePlaylists(new Request(url, { method: request.method }))
  } catch {
    result = new Response(JSON.stringify({ error: 'dev_middleware_failed' }), {
      status: 500,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }
  response.statusCode = result.status
  result.headers.forEach((value, name) => response.setHeader(name, value))
  response.end(Buffer.from(await result.arrayBuffer()))
}
