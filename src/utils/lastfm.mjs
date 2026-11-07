/**
 * Last.fm 听歌数据的唯一属主：用户身份、七天窗口、查询与校验、排行和统计、专辑封面。
 *
 * 只在服务端运行：Vercel 函数（`api/lastfm.js`）、本地 dev 中间件和单测。构建页面与
 * 访问页面都不调用 Last.fm，听歌数据一律经运行时接口取得。
 */

const API_URL = 'https://ws.audioscrobbler.com/2.0/'
const WEEK_SECONDS = 7 * 24 * 60 * 60
const MAX_RECENT_PAGES = 10
const COVER_CONCURRENCY = 3
const PLACEHOLDER_IMAGE = '2a96cbd8b46e442fc41c2b86b821562f'

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
const songKey = (name, artist) =>
  JSON.stringify(
    [name, artist].map((part) => part.normalize('NFC').toLowerCase())
  )
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
const albumImages = (details) => {
  const album = details?.album
  if (
    !details ||
    typeof details !== 'object' ||
    Array.isArray(details) ||
    !album ||
    typeof album !== 'object' ||
    Array.isArray(album) ||
    !Array.isArray(album.image)
  )
    throw new Error('Last.fm: invalid album.getInfo response')
  return album.image
}

// Last.fm's ar0 variant preserves the original artwork dimensions.
export const lastfmOriginalCover = (cover) =>
  cover ? cover.replace(/\/i\/u\/[^/]+\//, '/i/u/ar0/') : null

/** 一次 Last.fm API 调用；错误消息不含 URL 与密钥。 */
const createRequest =
  ({ apiKey, user, fetchImpl }) =>
  async (method, params = {}, optionalAlbum = false) => {
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
    if (data.error) {
      if (optionalAlbum && Number(data.error) === 6) return null
      throw new Error(`Last.fm: ${method} API error ${Number(data.error)}`)
    }
    return data
  }

const trackUrl = (artist, name) =>
  `https://www.last.fm/music/${encodeURIComponent(artist)}/_/${encodeURIComponent(name)}`

/**
 * 正在播放／最近一首：只取 `user.getRecentTracks` 的第一条。Last.fm 只标记
 * `nowplaying`，不提供播放进度或开始时间，所以这里也不推算进度。
 */
export async function fetchLastfmNowPlaying({
  apiKey,
  user = LASTFM_USER,
  now = new Date(),
  fetchImpl = fetch,
} = {}) {
  text(apiKey, 'API key (set LASTFM_API_KEY)')
  text(user, 'user')
  const request = createRequest({ apiKey, user, fetchImpl })
  const recent = await request('user.getRecentTracks', { limit: '1' })
  const [latest] = list(recent.recenttracks?.track, 'recent tracks')
  const base = {
    user,
    profileUrl: lastfmProfileUrl(user),
    updatedAt: now.toISOString(),
  }
  if (!latest) return { ...base, playing: false, playedAt: null, track: null }
  const playing = latest['@attr']?.nowplaying === 'true'
  const name = text(latest.name, 'recent name')
  const artist = text(latest.artist?.['#text'], 'recent artist')
  const cover = coverOf(latest.image)
  return {
    ...base,
    playing,
    playedAt: playing
      ? null
      : new Date(count(latest.date?.uts, 'scrobble time') * 1000).toISOString(),
    track: {
      name,
      artist,
      album:
        typeof latest.album?.['#text'] === 'string'
          ? latest.album['#text'].trim() || null
          : null,
      cover,
      url: trackUrl(artist, name),
    },
  }
}

export async function fetchLastfmSnapshot({
  apiKey,
  user = LASTFM_USER,
  now = new Date(),
  fetchImpl = fetch,
} = {}) {
  text(apiKey, 'API key (set LASTFM_API_KEY)')
  text(user, 'user')
  const to = Math.floor(now.getTime() / 1000)
  if (!Number.isSafeInteger(to) || to < WEEK_SECONDS)
    throw new Error('Last.fm: invalid sync time')
  const from = to - WEEK_SECONDS

  const request = createRequest({ apiKey, user, fetchImpl })
  const recentParams = { from: String(from), to: String(to), limit: '200' }
  const [top, recent, info, artists] = await Promise.all([
    request('user.getTopTracks', { period: '7day', limit: '10' }),
    request('user.getRecentTracks', { ...recentParams, page: '1' }),
    request('user.getInfo'),
    request('user.getTopArtists', { period: '7day', limit: '1' }),
  ])
  const tracks = list(top.toptracks?.track, 'top tracks')
    .slice(0, 10)
    .map((track) => {
      const name = text(track.name, 'track name')
      const artist = text(track.artist?.name, 'track artist')
      return {
        name,
        artist,
        album: null,
        cover: null,
        url: trackUrl(artist, name),
        playcount: count(track.playcount, 'track playcount'),
      }
    })
  const weeklyScrobbles = count(
    recent.recenttracks?.['@attr']?.total,
    'week total'
  )
  const totalScrobbles = count(info.user?.playcount, 'total playcount')
  const topArtists = list(artists.topartists?.artist, 'top artists')
  const topArtist = topArtists.length
    ? text(topArtists[0].name, 'top artist')
    : null
  const totalPages = count(
    recent.recenttracks?.['@attr']?.totalPages,
    'recent pages'
  )
  const wanted = new Set(
    tracks.map((track) => songKey(track.name, track.artist))
  )
  const albums = new Map()
  let pageData = recent
  for (
    let page = 1;
    page <= Math.min(MAX_RECENT_PAGES, Math.max(1, totalPages));
    page++
  ) {
    if (page > 1)
      pageData = await request('user.getRecentTracks', {
        ...recentParams,
        page: String(page),
      })
    for (const played of list(pageData.recenttracks?.track, 'recent tracks')) {
      if (played['@attr']?.nowplaying === 'true') continue
      const timestamp = count(played.date?.uts, 'scrobble time')
      if (timestamp < from || timestamp > to) continue
      const key = songKey(
        text(played.name, 'recent name'),
        text(played.artist?.['#text'], 'recent artist')
      )
      if (!wanted.has(key) || albums.has(key)) continue
      albums.set(key, {
        album:
          typeof played.album?.['#text'] === 'string'
            ? played.album['#text'].trim() || null
            : null,
        cover: coverOf(played.image),
      })
    }
    if (albums.size === wanted.size) break
  }

  // Only this snapshot shares lookups; retain both in-flight and resolved results.
  const covers = new Map()
  const albumCover = (artist, album) => {
    const key = JSON.stringify([artist, album])
    if (!covers.has(key))
      covers.set(
        key,
        request('album.getInfo', { artist, album }, true).then((details) =>
          details ? coverOf(albumImages(details)) : null
        )
      )
    return covers.get(key)
  }
  const fillCover = async (track) => {
    Object.assign(track, albums.get(songKey(track.name, track.artist)))
    if (track.cover || !track.album) return
    const baseAlbum = track.album
      .replace(/\s*\((?:explicit|deluxe(?:\s+(?:version|edition))?)\)\s*$/i, '')
      .trim()
    const albumNames = [...new Set([track.album, baseAlbum])].filter(Boolean)
    for (const album of albumNames) {
      track.cover = await albumCover(track.artist, album)
      if (track.cover) break
    }
  }
  for (let start = 0; start < tracks.length; start += COVER_CONCURRENCY)
    await Promise.all(
      tracks.slice(start, start + COVER_CONCURRENCY).map(fillCover)
    )

  return {
    user,
    profileUrl: lastfmProfileUrl(user),
    updatedAt: new Date(to * 1000).toISOString(),
    weeklyScrobbles,
    totalScrobbles,
    topArtist,
    tracks: tracks.map((track) => ({
      ...track,
      fullCover: lastfmOriginalCover(track.cover),
    })),
  }
}
