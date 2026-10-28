/** 服务端网易云适配器；只返回资料和可导出的曲目，不返回封面或播放资料。 */
const API_URL = 'https://music.163.com/api/playlist/detail'
const MAX_TRACKS = 5_000

const invalid = () => new Error('Netease playlist: invalid_payload')
const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value) => {
  if (value == null) return ''
  if (typeof value !== 'string') throw invalid()
  return value.trim()
}

/** 详情接口可能只提供部分曲目；保留标称总数，由页面说明实际可导出数量。 */
function normalizeNeteasePayload(payload) {
  if (!isObject(payload) || payload.code !== 200 || !isObject(payload.result))
    throw invalid()
  const { name, creator, description, trackCount, tracks } = payload.result
  if (
    !Number.isSafeInteger(trackCount) ||
    trackCount < 0 ||
    !Array.isArray(tracks) ||
    trackCount < tracks.length ||
    (trackCount > 0 && tracks.length === 0) ||
    (creator != null && !isObject(creator))
  )
    throw invalid()
  return {
    title: text(name),
    author: text(creator?.nickname),
    description: text(description),
    songCount: trackCount,
    songs: tracks.slice(0, MAX_TRACKS).map((track) => {
      if (
        !isObject(track) ||
        !Array.isArray(track.artists) ||
        (track.album != null && !isObject(track.album))
      )
        throw invalid()
      const title = text(track.name)
      if (!title) throw invalid()
      return {
        title,
        artist: track.artists
          .map((artist) => {
            if (!isObject(artist)) throw invalid()
            const name = text(artist.name)
            if (!name) throw invalid()
            return name
          })
          .join(' / '),
        album: text(track.album?.name),
      }
    }),
  }
}

export async function fetchNeteasePlaylist(
  sourceId,
  { fetchImpl = fetch, now = new Date() } = {}
) {
  if (typeof sourceId !== 'string' || !/^\d+$/.test(sourceId))
    throw new Error('Netease playlist: invalid_source_id')
  const url = new URL(API_URL)
  url.search = new URLSearchParams({
    id: sourceId,
    n: String(MAX_TRACKS),
    s: '0',
  }).toString()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetchImpl(url, {
      headers: {
        'referer': 'https://music.163.com/',
        'user-agent': 'Mozilla/5.0 (compatible; YuBlog playlists)',
      },
      signal: controller.signal,
    })
    if (!response.ok) throw invalid()
    return {
      ...normalizeNeteasePayload(JSON.parse(await response.text())),
      updatedAt: now.toISOString(),
    }
  } catch {
    throw new Error('Netease playlist: upstream_unavailable')
  } finally {
    clearTimeout(timeout)
  }
}
