/**
 * 首页屏幕时间的运行时接口。
 *
 * 只有这里决定响应的缓存策略、状态码和失败语义；Blob 上下行由
 * `src/utils/screen-time-store.mjs` 负责，快照形状由 `src/utils/screen-time.js` 校验。
 */

import { parseScreenTime } from '../src/utils/screen-time.js'
import { readScreenTime } from '../src/utils/screen-time-store.mjs'

/**
 * 数据由本机每小时推送一次，边缘缓存只需短到不叠加明显延迟：过期后一分钟内先返回
 * 旧数据并在后台刷新，上游出错时最多再沿用一天旧数据，避免同步失败让区块变空。
 * 缓存时长也决定上游请求次数，而 Hobby 的 Blob 操作额度有限，所以不用更短的值。
 */
const CACHE =
  'public, max-age=0, s-maxage=600, stale-while-revalidate=60, stale-if-error=86400'
const NO_STORE = 'no-store'

const json = (body, { status = 200, cache }) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cache,
    },
  })

/** 未连接 Blob 存储时没有可读的读取器，接口按缺少配置处理。 */
function blobReader() {
  const storeId = process.env.BLOB_STORE_ID
  return storeId ? () => readScreenTime({ storeId }) : null
}

/**
 * 处理一次屏幕时间请求。
 *
 * `read` 返回未经校验的响应体，形状统一在这里校验：所以 Vercel 与本机 dev 中间件
 * 对畸形快照的反应完全一致。错误响应一律不缓存，失败要能被下一次请求覆盖。
 */
export async function handleScreenTime(request, { read = blobReader() } = {}) {
  if (request.method !== 'GET')
    return new Response(null, {
      status: 405,
      headers: { 'allow': 'GET', 'cache-control': NO_STORE },
    })
  if (new URL(request.url).search)
    return json({ error: 'unexpected_query' }, { status: 400, cache: NO_STORE })
  if (!read)
    return json(
      { error: 'missing_blob_store' },
      { status: 503, cache: NO_STORE }
    )
  try {
    return json(parseScreenTime(await read()), { cache: CACHE })
  } catch (error) {
    // 存储与校验的错误消息不含凭据，可以安全写入运行日志。
    console.error(error.message)
    return json(
      { error: 'snapshot_unavailable' },
      { status: 502, cache: NO_STORE }
    )
  }
}

export default {
  fetch: (request) => handleScreenTime(request),
}
