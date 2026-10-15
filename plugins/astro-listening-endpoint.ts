import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

import type { AstroIntegration } from 'astro'

import { handleListening } from '../api/lastfm.js'

/** 与 Vercel 上的函数路径一致；接口不受站点 base 影响。 */
const ROUTE = '/api/lastfm'

/**
 * 让 `pnpm dev` 也有听歌接口。
 *
 * 线上由 Vercel 函数提供数据，本地没有对应运行时，页面只能停在加载状态。这里把
 * 同一个处理函数挂到 Vite 中间件上，本地与线上走同一份实现和同一套失败语义。
 *
 * 密钥优先取环境变量，其次读 `.env`：Astro 的 dev 只把 `.env` 交给 `import.meta.env`，
 * 不写入 `process.env`，而这个处理函数按线上的方式读取后者。
 */
export function listeningEndpointIntegration(): AstroIntegration {
  return {
    name: 'listening-endpoint',
    hooks: {
      'astro:config:setup': ({ command, updateConfig }) => {
        if (command !== 'dev') return
        updateConfig({
          vite: {
            plugins: [
              {
                name: 'listening-endpoint',
                apply: 'serve',
                configureServer(server) {
                  server.middlewares.use(ROUTE, (request, response) => {
                    void respond(request, response)
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
  request: IncomingMessage & { originalUrl?: string },
  response: ServerResponse
) {
  const url = new URL(request.originalUrl ?? request.url ?? ROUTE, 'http://dev')
  let result
  try {
    const env = { ...(await dotenv()), ...process.env }
    result = await handleListening(
      new Request(url, { method: request.method }),
      { apiKey: env.LASTFM_API_KEY, user: env.LASTFM_USER }
    )
  } catch (error) {
    console.error(error)
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

let dotenvCache
function dotenv() {
  dotenvCache ??= readFile(join(process.cwd(), '.env'), 'utf8').then(
    (contents) => parseEnv(contents),
    () => ({})
  )
  return dotenvCache
}
