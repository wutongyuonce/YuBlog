/** 服务端网易云适配器；不把上游原文、封面或播放资料交给页面。 */
const DETAIL_URL = 'https://music.163.com/api/playlist/detail'
const TRACKS_URL = 'https://music.163.com/api/v3/song/detail'

/** 详情接口只回前若干首，缺的按 id 批量补齐；两者都用同一上限防跑飞。 */
const TRACK_BATCH = 200
const MAX_TRACKS = 5_000
const TIMEOUT = 15_000

const invalid = () => new Error('Netease playlist: invalid_payload')
const unavailable = () => new Error('Netease playlist: upstream_unavailable')
const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value) => {
  if (value == null) return ''
  if (typeof value !== 'string') throw invalid()
  return value.trim()
}

/** 详情里的旧字段是 artists／album，歌曲接口用 ar／al；两种形状都接受。 */
export function normalizeNeteaseTrack(track) {
  if (!isObject(track)) throw invalid()
  const artists = track.artists ?? track.ar
  const album = track.album ?? track.al
  if (!Array.isArray(artists) || (album != null && !isObject(album)))
    throw invalid()
  const title = text(track.name)
  if (!title) throw invalid()
  return {
    title,
    artist: artists
      .map((artist) => {
        if (!isObject(artist)) throw invalid()
        const name = text(artist.name)
        if (!name) throw invalid()
        return name
      })
      .join(' / '),
    album: text(album?.name),
  }
}

/** 解析歌单详情：资料、曲目数量和已返回的曲目；缺的曲目由 trackIds 补齐。 */
export function parseNeteaseDetail(body) {
  try {
    const payload = JSON.parse(body)
    const result = isObject(payload) ? payload.result : null
    if (!isObject(result)) throw invalid()
    const { trackCount, tracks, trackIds } = result
    if (
      !Number.isSafeInteger(trackCount) ||
      trackCount < 0 ||
      !Array.isArray(tracks) ||
      trackCount < tracks.length ||
      (trackIds != null && !Array.isArray(trackIds))
    )
      throw invalid()
    return {
      title: text(result.name),
      author: text(result.creator?.nickname),
      description: text(result.description),
      songCount: trackCount,
      trackIds: (trackIds ?? []).map((entry) => {
        if (!isObject(entry) || !Number.isSafeInteger(entry.id)) throw invalid()
        return entry.id
      }),
      songs: tracks.map(normalizeNeteaseTrack),
    }
  } catch {
    throw invalid()
  }
}

/** 解析批量歌曲接口；顺序与请求的 id 顺序一致。 */
export function parseNeteaseTracks(body) {
  try {
    const payload = JSON.parse(body)
    if (!isObject(payload) || !Array.isArray(payload.songs)) throw invalid()
    return payload.songs.map(normalizeNeteaseTrack)
  } catch {
    throw invalid()
  }
}

const request = async (url, fetchImpl, signal) => {
  const response = await fetchImpl(url, {
    headers: {
      'referer': 'https://music.163.com/',
      'user-agent': 'Mozilla/5.0 (compatible; YuBlog playlists)',
    },
    signal,
  })
  if (!response.ok) throw unavailable()
  return response.text()
}

/** 详情返回的曲目少于标称数量时，按 trackIds 顺序整份重取，避免顺序错位。 */
const fetchAllTracks = async (trackIds, fetchImpl, signal) => {
  const ids = trackIds.slice(0, MAX_TRACKS)
  const songs = []
  for (let index = 0; index < ids.length; index += TRACK_BATCH) {
    const url = new URL(TRACKS_URL)
    url.search = new URLSearchParams({
      c: JSON.stringify(
        ids.slice(index, index + TRACK_BATCH).map((id) => ({ id }))
      ),
    }).toString()
    songs.push(...parseNeteaseTracks(await request(url, fetchImpl, signal)))
  }
  return songs
}

export async function fetchNeteasePlaylist(
  sourceId,
  { fetchImpl = fetch, now = new Date() } = {}
) {
  if (typeof sourceId !== 'string' || !/^\d+$/.test(sourceId))
    throw new Error('Netease playlist: invalid_source_id')
  const url = new URL(DETAIL_URL)
  url.search = new URLSearchParams({
    id: sourceId,
    n: String(MAX_TRACKS),
    s: '0',
  }).toString()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT)
  try {
    const detail = parseNeteaseDetail(
      await request(url, fetchImpl, controller.signal)
    )
    const songs =
      detail.songs.length < detail.songCount && detail.trackIds.length
        ? await fetchAllTracks(detail.trackIds, fetchImpl, controller.signal)
        : detail.songs
    if (detail.songCount > 0 && songs.length === 0) throw invalid()
    return {
      title: detail.title,
      author: detail.author,
      description: detail.description,
      songCount: detail.songCount,
      songs,
      updatedAt: now.toISOString(),
    }
  } catch {
    // 网络错误、JSON 解析错误及超时均不泄露上游响应或异常原文。
    throw unavailable()
  } finally {
    clearTimeout(timeout)
  }
}
