import config from '../data/playlists.json' with { type: 'json' }
import { fetchQqPlaylist } from './qq-playlist.mjs'

/** 固定配置的全量快照；不接受访问者传入的平台、ID 或 URL。 */
export async function fetchPlaylistsSnapshot({
  fetchImpl,
  now = new Date(),
} = {}) {
  const playlists = await Promise.all(
    config.map(async (entry) => {
      // netease 可在此接入；未实现的平台明确失败，不转为任意 URL 代理。
      if (entry.platform !== 'qq') throw new Error('Playlist: not_implemented')
      const data = await fetchQqPlaylist(entry.sourceId, { fetchImpl, now })
      return {
        ...entry,
        title: data.title || entry.title || entry.id,
        author: data.author,
        description: data.description,
        songCount: data.songCount,
        songs: data.songs,
      }
    })
  )
  return { updatedAt: now.toISOString(), playlists }
}
