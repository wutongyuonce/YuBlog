const isText = (value) => typeof value === 'string'

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

const collator = new Intl.Collator('zh-Hans-CN', {
  numeric: true,
  sensitivity: 'base',
})

/** 副本排序，保留原快照；同字段依次按歌名、歌手、专辑和原序号稳定排序。 */
export function sortPlaylistSongs(songs, key) {
  if (!['title', 'artist', 'album'].includes(key)) return [...songs]
  const keys = [...new Set([key, 'title', 'artist', 'album'])]
  return songs
    .map((song, index) => ({ song, index }))
    .sort((a, b) => {
      for (const field of keys) {
        const compared = collator.compare(a.song[field], b.song[field])
        if (compared) return compared
      }
      return a.index - b.index
    })
    .map(({ song }) => song)
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
  const switcher = find('[data-switcher]')
  const sort = find('[data-sort]')
  const exportButton = find('[data-export]')
  const status = find('[data-status]')
  const viewport = find('[data-tracks]')
  let snapshot = null
  let currentSongs = []

  root.dataset.state = 'loading'
  root.setAttribute('aria-busy', 'true')
  switcher.disabled = sort.disabled = exportButton.disabled = true
  status.textContent = '正在获取歌单…'
  const skeletons = root.querySelectorAll('[data-skeleton]')
  skeletons.forEach((element) => {
    element.hidden = false
  })
  for (const selector of [
    '[data-details]',
    '[data-tracks]',
    '[data-empty]',
    '[data-fallback]',
    '[data-updated]',
    '[data-partial]',
  ])
    find(selector).hidden = true

  const show = () => {
    const playlist = snapshot.playlists.find(
      (entry) => entry.id === switcher.value
    )
    if (!playlist) return
    const title = find('[data-title]')
    title.textContent = playlist.title
    title.href = playlist.url
    const cover = find('[data-cover]')
    cover.src = playlist.cover
    cover.alt = `${playlist.title}的封面`
    find('[data-author]').textContent = playlist.author || '作者信息暂缺'
    find('[data-source]').textContent =
      playlist.platform === 'qq' ? 'QQ 音乐' : '网易云音乐'
    find('[data-count]').textContent = `${playlist.songCount} 首`
    const description = find('[data-description]')
    description.textContent = playlist.description
    description.hidden = !playlist.description
    currentSongs = sortPlaylistSongs(playlist.songs, sort.value)
    const rows = document.createDocumentFragment()
    currentSongs.forEach((song, index) => {
      const row = find('[data-song-template]').content.cloneNode(true)
      const values = [
        String(index + 1).padStart(2, '0'),
        song.title,
        song.artist || '歌手信息暂缺',
        song.album || '专辑信息暂缺',
      ]
      row.querySelectorAll('td').forEach((cell, column) => {
        cell.textContent = values[column]
        cell.title = values[column]
      })
      rows.append(row)
    })
    find('[data-song-list]').replaceChildren(rows)
    viewport.scrollTop = 0
    viewport.hidden = currentSongs.length === 0
    find('[data-empty]').hidden = currentSongs.length !== 0
    sort.disabled = currentSongs.length === 0
    exportButton.disabled = currentSongs.length === 0
    root.dataset.state = currentSongs.length ? 'ready' : 'empty'
    status.textContent = currentSongs.length
      ? `已显示 ${currentSongs.length} 首歌曲。`
      : '歌单里还没有歌曲。'
    const partial = find('[data-partial]')
    partial.hidden = playlist.songCount === currentSongs.length
    partial.textContent = `当前可查看 ${currentSongs.length} 首，共 ${playlist.songCount} 首。`
  }

  switcher.addEventListener(
    'change',
    () => {
      sort.value = 'original'
      show()
    },
    { signal }
  )
  sort.addEventListener('change', show, { signal })
  exportButton.addEventListener(
    'click',
    () => {
      const playlist = snapshot.playlists.find(
        (entry) => entry.id === switcher.value
      )
      const url = URL.createObjectURL(
        new Blob([playlistText(currentSongs)], {
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
      snapshot = data
      for (const option of switcher.options) {
        option.textContent = data.playlists.find(
          (entry) => entry.id === option.value
        ).title
      }
      switcher.disabled = false
      find('[data-details]').hidden = false
      skeletons.forEach((element) => {
        element.hidden = true
      })
      const updated = find('[data-updated]')
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
      show()
    } catch {
      if (signal.aborted || !root.isConnected) return
      root.dataset.state = 'failed'
      status.textContent = '暂时无法获取歌单数据。'
      skeletons.forEach((element) => {
        element.hidden = true
      })
      find('[data-fallback]').hidden = false
    } finally {
      if (!signal.aborted) root.setAttribute('aria-busy', 'false')
    }
  }
  void load()
  return () => controller.abort()
}
