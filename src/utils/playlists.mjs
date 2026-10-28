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
    config.map(async ({ cover, ...entry }) => {
      // 只接受注册表自身的项，不把 Object 原型上的方法当成适配器。
      if (!Object.hasOwn(ADAPTERS, entry.platform))
        throw new Error('Playlist: not_implemented')
      const data = await ADAPTERS[entry.platform](entry.sourceId, {
        fetchImpl,
      })
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
