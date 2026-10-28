import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'

import type { AstroIntegration } from 'astro'

import { handleScreenTime } from '../api/screen-time.js'
import { SNAPSHOT_PATH } from '../scripts/sync-screen-time.mjs'

/** 与 Vercel 上的函数路径一致；接口不受站点 base 影响。 */
const ROUTE = '/api/screen-time'

/**
 * 让 `pnpm dev` 也有屏幕时间接口。
 *
 * 线上由 Vercel 函数读取 Blob 存储，本地没有对应凭据，页面只能停在加载状态。这里把
 * 本机同步脚本写下的 `.local/screen-time.json` 交给同一个处理函数，所以形状校验、
 * 状态码与缓存头和线上一致，只有数据来源不同。
 */
export function screenTimeEndpointIntegration(): AstroIntegration {
  return {
    name: 'screen-time-endpoint',
    hooks: {
      'astro:config:setup': ({ command, updateConfig }) => {
        if (command !== 'dev') return
        updateConfig({
          vite: {
            plugins: [
              {
                name: 'screen-time-endpoint',
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
    result = await handleScreenTime(
      new Request(url, { method: request.method }),
      {
        read: async () =>
          JSON.parse(
            await readFile(join(process.cwd(), SNAPSHOT_PATH), 'utf8')
          ),
      }
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
