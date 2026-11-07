/**
 * 首页听歌数据的运行时接口。
 *
 * 只有这里决定七日快照的缓存窗口；状态码与失败语义在 `_lastfm-response.js`，
 * Last.fm 的查询、校验与错误消息由 `src/utils/lastfm.mjs` 负责。
 */

import { fetchLastfmSnapshot } from '../src/utils/lastfm.mjs'
import { respondWithLastfm } from './_lastfm-response.js'

/**
 * CDN 缓存 1 小时：过期后 5 分钟内先返回旧数据并在后台刷新；上游出错时最多再沿用
 * 一天旧数据，避免 Last.fm 抖动让首页听歌区块变空。
 */
const CACHE =
  'public, max-age=0, s-maxage=3600, stale-while-revalidate=300, stale-if-error=86400'

/** 处理一次听歌数据请求。 */
export function handleListening(
  request,
  { apiKey, user, fetchImpl, now } = {}
) {
  return respondWithLastfm(request, {
    apiKey,
    cache: CACHE,
    load: () => fetchLastfmSnapshot({ apiKey, user, now, fetchImpl }),
  })
}

export default {
  fetch: (request) =>
    handleListening(request, {
      apiKey: process.env.LASTFM_API_KEY,
      user: process.env.LASTFM_USER,
    }),
}
