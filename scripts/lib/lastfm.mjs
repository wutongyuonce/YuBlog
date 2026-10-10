const API_URL = 'https://ws.audioscrobbler.com/2.0/'
const WEEK_SECONDS = 7 * 24 * 60 * 60
const MAX_RECENT_PAGES = 10
const PLACEHOLDER_IMAGE = '2a96cbd8b46e442fc41c2b86b821562f'

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

export async function fetchLastfmSnapshot({
  apiKey,
  user = 'ztyonce',
  now = new Date(),
  fetchImpl = fetch,
} = {}) {
  text(apiKey, 'API key (set LASTFM_API_KEY)')
  text(user, 'user')
  const to = Math.floor(now.getTime() / 1000)
  if (!Number.isSafeInteger(to) || to < WEEK_SECONDS)
    throw new Error('Last.fm: invalid sync time')
  const from = to - WEEK_SECONDS

  const request = async (method, params = {}, optionalAlbum = false) => {
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
        url: `https://www.last.fm/music/${encodeURIComponent(artist)}/_/${encodeURIComponent(name)}`,
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

  for (const track of tracks) {
    Object.assign(track, albums.get(songKey(track.name, track.artist)))
    if (track.cover || !track.album) continue
    const baseAlbum = track.album
      .replace(/\s*\((?:explicit|deluxe(?:\s+(?:version|edition))?)\)\s*$/i, '')
      .trim()
    const albumNames = [...new Set([track.album, baseAlbum])].filter(Boolean)
    for (const album of albumNames) {
      const details = await request(
        'album.getInfo',
        { artist: track.artist, album },
        true
      )
      if (!details) continue
      track.cover = coverOf(albumImages(details))
      if (track.cover) break
    }
  }

  return {
    user,
    profileUrl: `https://www.last.fm/user/${encodeURIComponent(user)}`,
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
