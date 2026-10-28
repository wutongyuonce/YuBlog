/** 服务端 QQ 适配器；不把上游原文、封面或播放资料交给页面。 */
const API_URL =
  'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg'

const invalid = () => new Error('QQ playlist: invalid_payload')
const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value) => {
  if (value == null) return ''
  if (typeof value !== 'string') throw invalid()
  return value.trim()
}

/** 纯字段归一化：缺失专辑／歌手保留空字符串，由视图显示占位。 */
export function normalizeQqPayload(item) {
  if (!isObject(item)) throw invalid()
  const songs = item.songlist ?? item.songList
  if (
    !Array.isArray(songs) ||
    !Number.isSafeInteger(item.songnum) ||
    item.songnum < songs.length ||
    item.songnum < 0 ||
    (item.songnum > 0 && songs.length === 0)
  )
    throw invalid()

  return {
    title: text(item.dissname),
    author: text(item.nickname),
    description: text(item.desc),
    songCount: item.songnum,
    songs: songs.map((song) => {
      if (
        !isObject(song) ||
        !Array.isArray(song.singer) ||
        (song.album != null && !isObject(song.album))
      )
        throw invalid()
      const title = text(song.title) || text(song.name)
      if (!title) throw invalid()
      const singers = song.singer.map((singer) => {
        if (!isObject(singer)) throw invalid()
        const name = text(singer.name)
        if (!name) throw invalid()
        return name
      })
      return {
        title,
        artist: singers.join(' / '),
        album: text(song.album?.title) || text(song.album?.name),
      }
    }),
  }
}

/** 只剥去固定 JSONP 包装，不执行脚本；同时接受上游的纯 JSON 响应。 */
export function parseQqResponse(body) {
  try {
    const raw = body.trim()
    const wrapped = /^jsonCallback\s*\(([\s\S]*)\)\s*;?$/.exec(raw)
    const payload = JSON.parse(wrapped ? wrapped[1] : raw)
    if (
      !isObject(payload) ||
      payload.code !== 0 ||
      !Array.isArray(payload.cdlist) ||
      payload.cdlist.length !== 1
    )
      throw invalid()
    return normalizeQqPayload(payload.cdlist[0])
  } catch {
    throw invalid()
  }
}

export async function fetchQqPlaylist(sourceId, { fetchImpl = fetch } = {}) {
  if (typeof sourceId !== 'string' || !/^\d+$/.test(sourceId))
    throw new Error('QQ playlist: invalid_source_id')
  const url = new URL(API_URL)
  url.search = new URLSearchParams({
    type: '1',
    json: '1',
    utf8: '1',
    onlysong: '0',
    new_format: '1',
    disstid: sourceId,
  }).toString()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetchImpl(url, {
      headers: { referer: 'https://y.qq.com/' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error('upstream_unavailable')
    return {
      ...parseQqResponse(await response.text()),
    }
  } catch {
    // 网络错误、JSON 解析错误及超时均不泄露上游响应或异常原文。
    throw new Error('QQ playlist: upstream_unavailable')
  } finally {
    clearTimeout(timeout)
  }
}
