import { tintFromRgba } from './playlist-cover-tint.js'

const isText = (value) => typeof value === 'string'

/** 从站内封面采样主色，写入卡片 CSS 变量；失败保留中性玻璃底。 */
export function applyPlaylistCoverTint(card, img) {
  if (!card || !img) return
  const paint = () => {
    try {
      if (!img.naturalWidth) return
      const size = 32
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(img, 0, 0, size, size)
      const tint = tintFromRgba(ctx.getImageData(0, 0, size, size).data)
      if (!tint) return
      card.style.setProperty('--playlist-tint', tint.tint)
      card.style.setProperty('--playlist-tint-soft', tint.soft)
      card.dataset.tint = 'ready'
    } catch {
      /* CORS／解码失败：保留默认中性 tint */
    }
  }
  if (img.complete && img.naturalWidth) paint()
  else img.addEventListener('load', paint, { once: true })
}

/** 先校验整个快照；封面和外链始终使用构建时的固定配置。 */
export function parsePlaylistsPayload(payload, config) {
  if (
    !payload ||
    !isText(payload.updatedAt) ||
    !Number.isFinite(Date.parse(payload.updatedAt)) ||
    !Array.isArray(payload.playlists) ||
    payload.playlists.length !== config.length
  )
    return null
  const ids = new Set()
  for (const playlist of payload.playlists) {
    const entry = config.find((entry) => entry.id === playlist?.id)
    if (
      !entry ||
      ids.has(playlist.id) ||
      playlist.platform !== entry.platform ||
      playlist.sourceId !== entry.sourceId ||
      !isText(playlist.title) ||
      !playlist.title.trim() ||
      !isText(playlist.author) ||
      !isText(playlist.description) ||
      !Number.isSafeInteger(playlist.songCount) ||
      playlist.songCount < 0 ||
      !Array.isArray(playlist.songs) ||
      playlist.songCount < playlist.songs.length ||
      (playlist.songCount > 0 && playlist.songs.length === 0) ||
      !playlist.songs.every(
        (song) =>
          song &&
          isText(song.title) &&
          song.title.trim() &&
          isText(song.artist) &&
          isText(song.album)
      )
    )
      return null
    ids.add(playlist.id)
  }
  return {
    updatedAt: payload.updatedAt,
    playlists: config.map((entry) => ({
      ...payload.playlists.find((playlist) => playlist.id === entry.id),
      cover: entry.cover,
      url: entry.url,
    })),
  }
}

export function playlistText(songs) {
  return songs
    .map((song) =>
      [song.title, song.artist, song.album]
        .map((field) => field.replace(/[\r\n\t]+/g, ' ').trim())
        .join(' - ')
    )
    .join('\n')
}

/** 每个页面元素持有自己的请求与监听器，断开时取消，旧请求不能覆盖新页面。 */
export function mountPlaylists(root) {
  const controller = new AbortController()
  const { signal } = controller
  const config = JSON.parse(root.dataset.config)
  const find = (selector) => root.querySelector(selector)
  const status = find('[data-status]')
  const updated = find('[data-updated]')
  const cards = Array.from(
    root.querySelectorAll('[data-playlist-id]'),
    (card) => ({
      id: card.dataset.playlistId,
      el: card,
      find: (selector) => card.querySelector(selector),
    })
  )
  let playlistsById = new Map()

  root.dataset.state = 'loading'
  root.setAttribute('aria-busy', 'true')
  status.textContent = '正在获取歌单…'
  updated.hidden = true

  for (const card of cards) {
    const entry = config.find((entry) => entry.id === card.id)
    card.find('[data-title]').textContent = entry.title || entry.id
    card.find('[data-export]').disabled = true
    card.find('[data-skeleton]').hidden = false
    for (const selector of [
      '[data-details]',
      '[data-meta]',
      '[data-description]',
      '[data-note]',
    ])
      card.find(selector).hidden = true

    card.find('[data-export]').addEventListener(
      'click',
      () => {
        const playlist = playlistsById.get(card.id)
        if (!playlist?.songs.length) return
        const url = URL.createObjectURL(
          new Blob([playlistText(playlist.songs)], {
            type: 'text/plain;charset=utf-8',
          })
        )
        const link = document.createElement('a')
        link.href = url
        link.download = `${playlist.title.replace(/[<>:"/\\|?*\p{Cc}]/gu, '_')}.txt`
        root.append(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      },
      { signal }
    )
  }

  const load = async () => {
    try {
      const response = await fetch('/api/playlists', {
        signal,
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error('unavailable')
      const data = parsePlaylistsPayload(await response.json(), config)
      if (!data) throw new Error('invalid_payload')
      if (signal.aborted || !root.isConnected) return
      playlistsById = new Map(
        data.playlists.map((playlist) => [playlist.id, playlist])
      )

      for (const card of cards) {
        const playlist = playlistsById.get(card.id)
        card.find('[data-title]').textContent = playlist.title
        card.find('[data-cover]').alt = `${playlist.title}的封面`
        card.find('[data-author]').textContent =
          playlist.author || '作者信息暂缺'
        card.find('[data-count]').textContent = `${playlist.songCount} 首`
        card.find('[data-meta]').hidden = false
        const description = card.find('[data-description]')
        description.textContent = playlist.description
        description.hidden = !playlist.description.trim()
        const note = card.find('[data-note]')
        note.hidden =
          playlist.songCount === playlist.songs.length && playlist.songCount > 0
        note.textContent =
          playlist.songCount === 0
            ? '歌单里还没有歌曲。'
            : `当前可导出 ${playlist.songs.length} 首，共 ${playlist.songCount} 首。`
        card.find('[data-export]').disabled = playlist.songs.length === 0
        card.find('[data-skeleton]').hidden = true
        card.find('[data-details]').hidden = false
        applyPlaylistCoverTint(card.el, card.find('[data-cover]'))
      }

      updated.dateTime = data.updatedAt
      updated.textContent = `更新于 ${new Date(data.updatedAt).toLocaleString(
        'zh-CN',
        {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }
      )}`
      updated.hidden = false
      root.dataset.state = 'ready'
      status.textContent = `已加载 ${data.playlists.length} 份歌单。`
    } catch {
      if (signal.aborted || !root.isConnected) return
      root.dataset.state = 'failed'
      status.textContent =
        '暂时无法获取歌单数据，可以点击歌单标题前往原平台查看。'
      for (const card of cards) {
        card.find('[data-skeleton]').hidden = true
        card.find('[data-details]').hidden = false
        applyPlaylistCoverTint(card.el, card.find('[data-cover]'))
      }
    } finally {
      if (!signal.aborted) root.setAttribute('aria-busy', 'false')
    }
  }
  void load()
  return () => controller.abort()
}
