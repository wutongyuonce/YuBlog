/**
 * 首页听歌数据的运行时接口。
 *
 * 只有这里决定响应的缓存策略、状态码和失败语义；Last.fm 的查询、校验与错误消息由
 * `src/utils/lastfm.mjs` 负责，这里不重新判断排行、统计或封面。
 */

import { fetchLastfmSnapshot } from '../src/utils/lastfm.mjs'

/**
 * CDN 缓存 30 分钟：过期后 5 分钟内先返回旧数据并在后台刷新；上游出错时最多再沿用
 * 一天旧数据，避免 Last.fm 抖动让首页听歌区块变空。
 */
const CACHE =
  'public, max-age=0, s-maxage=1800, stale-while-revalidate=300, stale-if-error=86400'
const NO_STORE = 'no-store'

const json = (body, { status = 200, cache }) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cache,
    },
  })

/**
 * 处理一次听歌数据请求。
 *
 * 错误响应一律不带缓存：失败的请求要能被下一次请求覆盖，也不能让带查询参数的地址
 * 绕开缓存、反复触发上游查询。
 */
export async function handleListening(
  request,
  { apiKey, user, fetchImpl, now } = {}
) {
  if (request.method !== 'GET')
    return new Response(null, {
      status: 405,
      headers: { 'allow': 'GET', 'cache-control': NO_STORE },
    })
  if (new URL(request.url).search)
    return json({ error: 'unexpected_query' }, { status: 400, cache: NO_STORE })
  if (typeof apiKey !== 'string' || !apiKey.trim())
    return json({ error: 'missing_api_key' }, { status: 503, cache: NO_STORE })
  try {
    const snapshot = await fetchLastfmSnapshot({ apiKey, user, now, fetchImpl })
    return json(snapshot, { cache: CACHE })
  } catch (error) {
    // 适配器保证消息里没有密钥和上游原文，可以安全写入运行日志。
    console.error(error.message)
    return json(
      { error: 'upstream_unavailable' },
      { status: 502, cache: NO_STORE }
    )
  }
}

export default {
  fetch: (request) =>
    handleListening(request, {
      apiKey: process.env.LASTFM_API_KEY,
      user: process.env.LASTFM_USER,
    }),
}
