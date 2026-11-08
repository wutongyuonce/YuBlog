/**
 * Last.fm 听歌数据的唯一属主：用户身份、查询与校验、各时段专辑排行、最近播放，以及
 * 封面来源（Last.fm 自带图优先，缺图时交给网易云回退）。
 *
 * 只在服务端运行：Vercel 函数（`api/lastfm.js`、`api/lastfm-now.js`）、本地 dev
 * 中间件和单测。构建页面与访问页面都不调用 Last.fm，听歌数据一律经运行时接口取得。
 */

import { findNeteaseCover, neteaseSized } from './netease-cover.mjs'
import { COLLAGE_SIZE, PERIODS, RECENT_SIZE } from './recent-listening.js'

const API_URL = 'https://ws.audioscrobbler.com/2.0/'
const PLACEHOLDER_IMAGE = '2a96cbd8b46e442fc41c2b86b821562f'
/** 列表与小格用的封面边长，以及 #1 大格用的边长。 */
const COVER_SIZE = 300
const LARGE_COVER_SIZE = 600
/** 网易云回退的并行上限。 */
const COVER_CONCURRENCY = 6
/** 整个回退阶段最多等这么久，之后缺图的条目保持缺图，接口照常返回。 */
const COVER_BUDGET = 2_500

/** 默认账户；请求与页面链接都从这一个常量派生。 */
export const LASTFM_USER = 'ztyonce'

export const lastfmProfileUrl = (user) =>
  `https://www.last.fm/user/${encodeURIComponent(user)}`

const text = (value, field) => {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`Last.fm: invalid ${field}`)
  return value.trim()
}
const count = (value, field) => {
  if (
    !['string', 'number'].includes(typeof value) ||
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value))
  )
    throw new Error(`Last.fm: invalid ${field}`)
  return Number(value)
}
const list = (value, field) => {
  if (Array.isArray(value)) return value
  if (value === '') return []
  throw new Error(`Last.fm: invalid ${field}`)
}

/** Last.fm 图片中最大的一张；空图、通用占位图和其它域名一律视为缺图。 */
const coverOf = (images) => {
  if (!Array.isArray(images)) return null
  for (const image of [...images].reverse()) {
    try {
      const url = new URL(image['#text'])
      if (
        url.protocol === 'https:' &&
        url.hostname === 'lastfm-img.freetls.fastly.net' &&
        !url.username &&
        !url.password &&
        !url.href.includes(PLACEHOLDER_IMAGE)
      )
        return url.href
    } catch {
      // Empty and missing images are normal in the Last.fm catalogue.
    }
  }
  return null
}

/** Last.fm 图片路径里的尺寸段可以换成任意边长。 */
const lastfmSized = (cover, size) =>
  cover.replace(/\/i\/u\/[^/]+\//, `/i/u/${size}x${size}/`)

/** 一次 Last.fm API 调用；错误消息不含 URL 与密钥。 */
const createRequest =
  ({ apiKey, user, fetchImpl }) =>
  async (method, params = {}) => {
    const url = new URL(API_URL)
    url.search = new URLSearchParams({
      method,
      user,
      api_key: apiKey,
      format: 'json',
      ...params,
    })
    let response, data
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) })
      data = await response.json()
    } catch {
      // Fetch errors can contain the URL and key; never forward them to logs.
      throw new Error(`Last.fm: ${method} request failed`)
    }
    if (!response.ok)
      throw new Error(`Last.fm: ${method} HTTP ${response.status}`)
    if (!data || typeof data !== 'object')
      throw new Error(`Last.fm: invalid ${method} response`)
    if (data.error)
      throw new Error(`Last.fm: ${method} API error ${Number(data.error)}`)
    return data
  }

const musicUrl = (...parts) =>
  `https://www.last.fm/music/${parts.map(encodeURIComponent).join('/')}`

/**
 * 给缺封面的条目补网易云封面：最多 `COVER_CONCURRENCY` 个查找同时进行；`findCover`
 * 从不 reject，查不到就保持缺图，同名同歌手由查找器合并成一次搜索。整个阶段受
 * `COVER_BUDGET` 限制：到时不再开始新查找，也不再写入迟到的结果。
 */
async function fillCovers(items, kind, findCover, apply) {
  const queue = items.filter((item) => !item.cover)
  if (!queue.length) return
  let expired = false
  const worker = async () => {
    for (let item; !expired && (item = queue.shift());) {
      const found = await findCover({
        kind,
        name: item.name,
        artist: item.artist,
      })
      if (found && !expired) apply(item, found)
    }
  }
  let timer
  await Promise.race([
    Promise.all(
      Array.from({ length: Math.min(COVER_CONCURRENCY, queue.length) }, worker)
    ),
    new Promise((resolve) => {
      timer = setTimeout(resolve, COVER_BUDGET)
    }),
  ])
  expired = true
  clearTimeout(timer)
}

/**
 * 正在播放与最近播放：`user.getRecentTracks` 的前 `RECENT_SIZE` 条，第一条给正在播放卡片。
 * Last.fm 只标记 `nowplaying`，不提供播放进度或开始时间，所以这里也不推算进度。
 */
export async function fetchLastfmNowPlaying({
  apiKey,
  user = LASTFM_USER,
  fetchImpl = fetch,
  findCover = findNeteaseCover,
} = {}) {
  text(apiKey, 'API key (set LASTFM_API_KEY)')
  text(user, 'user')
  const request = createRequest({ apiKey, user, fetchImpl })
  const recent = await request('user.getRecentTracks', {
    limit: String(RECENT_SIZE),
  })
  const items = list(recent.recenttracks?.track, 'recent tracks')
  const playing = items[0]?.['@attr']?.nowplaying === 'true'
  const tracks = items
    // 只有第一条可能是正在播放；其后的都必须是带时间的已记录播放。
    .filter(
      (item, index) => index === 0 || item['@attr']?.nowplaying !== 'true'
    )
    .slice(0, RECENT_SIZE)
    .map((item, index) => {
      const name = text(item.name, 'recent name')
      const artist = text(item.artist?.['#text'], 'recent artist')
      return {
        name,
        artist,
        album:
          typeof item.album?.['#text'] === 'string'
            ? item.album['#text'].trim() || null
            : null,
        cover: coverOf(item.image),
        url: musicUrl(artist, '_', name),
        playedAt:
          playing && index === 0
            ? null
            : new Date(
                count(item.date?.uts, 'scrobble time') * 1000
              ).toISOString(),
      }
    })
  await fillCovers(tracks, 'song', findCover, (track, found) => {
    track.cover = neteaseSized(found, COVER_SIZE)
  })
  return { playing, tracks }
}

/**
 * 封面墙快照：累计播放数，以及每个时段各自的专辑总数和前 `COLLAGE_SIZE` 张专辑。
 * 每张专辑带列表与大格两种尺寸的封面地址，页面按格子大小挑选。
 */
export async function fetchLastfmSnapshot({
  apiKey,
  user = LASTFM_USER,
  now = new Date(),
  fetchImpl = fetch,
  findCover = findNeteaseCover,
} = {}) {
  text(apiKey, 'API key (set LASTFM_API_KEY)')
  text(user, 'user')
  const request = createRequest({ apiKey, user, fetchImpl })
  const keys = Object.keys(PERIODS)
  const [info, ...tops] = await Promise.all([
    request('user.getInfo'),
    ...keys.map((period) =>
      request('user.getTopAlbums', { period, limit: String(COLLAGE_SIZE) })
    ),
  ])
  const periods = tops.map((top, index) => ({
    key: keys[index],
    albumTotal: count(top.topalbums?.['@attr']?.total, 'album total'),
    albums: list(top.topalbums?.album, 'top albums')
      .slice(0, COLLAGE_SIZE)
      .map((album) => {
        const name = text(album.name, 'album name')
        const artist = text(album.artist?.name, 'album artist')
        const cover = coverOf(album.image)
        return {
          name,
          artist,
          playcount: count(album.playcount, 'album playcount'),
          url: musicUrl(artist, name),
          cover: cover && lastfmSized(cover, COVER_SIZE),
          coverLarge: cover && lastfmSized(cover, LARGE_COVER_SIZE),
        }
      }),
  }))
  await fillCovers(
    periods.flatMap((period) => period.albums),
    'album',
    findCover,
    (album, found) => {
      album.cover = neteaseSized(found, COVER_SIZE)
      album.coverLarge = neteaseSized(found, LARGE_COVER_SIZE)
    }
  )
  return {
    updatedAt: now.toISOString(),
    totalScrobbles: count(info.user?.playcount, 'total playcount'),
    periods,
  }
}
