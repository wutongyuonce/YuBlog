/**
 * 首页「正在播放」与最近播放列表的运行时接口：最近六条播放记录。
 *
 * 与封面墙快照分开，是因为两者的新鲜度不同：快照可以缓存 1 小时，正在播放只缓存
 * 30 秒，页面每分钟轮询一次也不会把请求打到 Last.fm 上。
 */

import { fetchLastfmNowPlaying } from '../src/utils/lastfm.mjs'
import { respondWithLastfm } from './_lastfm-response.js'

const CACHE =
  'public, max-age=0, s-maxage=30, stale-while-revalidate=30, stale-if-error=600'

export function handleNowPlaying(
  request,
  { apiKey, user, fetchImpl, findCover } = {}
) {
  return respondWithLastfm(request, {
    apiKey,
    cache: CACHE,
    load: () => fetchLastfmNowPlaying({ apiKey, user, fetchImpl, findCover }),
  })
}

export default {
  fetch: (request) =>
    handleNowPlaying(request, {
      apiKey: process.env.LASTFM_API_KEY,
      user: process.env.LASTFM_USER,
    }),
}
