import config from '../data/playlists.json' with { type: 'json' }
import { fetchNeteasePlaylist } from './netease-playlist.mjs'
import { fetchQqPlaylist } from './qq-playlist.mjs'

/** 平台适配器：新增平台先在此注册，未注册的平台明确失败。 */
const ADAPTERS = {
  qq: fetchQqPlaylist,
  netease: fetchNeteasePlaylist,
}

/** 固定配置的全量快照；不接受访问者传入的平台、ID 或 URL。 */
export async function fetchPlaylistsSnapshot({
  fetchImpl,
  now = new Date(),
} = {}) {
  const playlists = await Promise.all(
    config.map(async (entry) => {
      // 未注册的平台明确失败，不转为任意 URL 代理。
      const adapter = ADAPTERS[entry.platform]
      if (!adapter) throw new Error('Playlist: not_implemented')
      const data = await adapter(entry.sourceId, { fetchImpl, now })
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
