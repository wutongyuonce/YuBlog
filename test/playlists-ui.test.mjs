import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mountPlaylists,
  parsePlaylistsPayload,
  playlistText,
} from '../src/utils/playlists-ui.js'
import { createDocument } from '../test-support/minimal-dom.mjs'

const songs = [
  { title: 'B', artist: 'A', album: 'Z' },
  { title: 'A', artist: 'B', album: 'Z' },
  { title: 'A', artist: 'A', album: 'Y' },
  { title: 'A', artist: 'A', album: 'Y' },
]
const config = [
  {
    id: 'qq-test',
    platform: 'qq',
    sourceId: '123',
    url: 'https://y.qq.com/n/ryqq/playlist/123',
  },
]
const payload = {
  updatedAt: '2026-10-28T02:00:00Z',
  playlists: [
    {
      ...config[0],
      title: '测试',
      author: '',
      description: '',
      songCount: songs.length,
      songs,
    },
  ],
}

test('exports exactly one plain-text line per track, including missing albums', () => {
  assert.equal(
    playlistText([
      { title: '歌\n曲', artist: '歌手一 / 歌手二', album: '专辑' },
      { title: '<歌名>', artist: '歌手', album: '' },
    ]),
    '歌 曲 - 歌手一 / 歌手二 - 专辑\n<歌名> - 歌手 - '
  )
  assert.equal(playlistText([]), '')
})

test('validates the whole response and keeps only configured links', () => {
  const data = structuredClone(payload)
  data.playlists[0].url = 'javascript:alert(1)'
  const parsed = parsePlaylistsPayload(data, config)
  assert.equal(parsed.playlists[0].url, config[0].url)
  for (const invalid of [
    null,
    {},
    { ...payload, updatedAt: 'invalid' },
    { ...payload, playlists: [] },
    { ...payload, playlists: [null] },
    { ...payload, playlists: [{ ...payload.playlists[0], id: 'unknown' }] },
    { ...payload, playlists: [{ ...payload.playlists[0], songCount: -1 }] },
    {
      ...payload,
      playlists: [
        {
          ...payload.playlists[0],
          songs: [{ title: 'A', artist: {}, album: '' }],
        },
      ],
    },
  ])
    assert.equal(parsePlaylistsPayload(invalid, config), null)
})

test('matches multiple playlists by id in config order and exports each original song order', () => {
  const secondEntry = {
    ...config[0],
    id: 'qq-second',
    sourceId: '456',
    url: 'https://y.qq.com/n/ryqq/playlist/456',
  }
  const secondPlaylist = {
    ...payload.playlists[0],
    ...secondEntry,
    title: '第二份歌单',
    songs: [songs[1], songs[0]],
    songCount: 2,
  }
  const multipleConfig = [...config, secondEntry]
  const data = {
    ...payload,
    playlists: [secondPlaylist, payload.playlists[0]],
  }
  const parsed = parsePlaylistsPayload(data, multipleConfig)
  assert.deepEqual(
    parsed.playlists.map(({ id }) => id),
    ['qq-test', 'qq-second']
  )
  assert.equal(
    playlistText(parsed.playlists[0].songs),
    'B - A - Z\nA - B - Z\nA - A - Y\nA - A - Y'
  )
  assert.equal(playlistText(parsed.playlists[1].songs), 'A - B - Z\nB - A - Z')
  assert.equal(
    parsePlaylistsPayload(
      {
        ...payload,
        playlists: [payload.playlists[0], payload.playlists[0]],
      },
      multipleConfig
    ),
    null
  )
})

/** 与 PlaylistsPanel 静态结构对齐：封面／标题／播放已亮，接口字段初始隐藏。 */
function playlistRoot(docConfig = config) {
  const document = createDocument()
  const root = document.createElement('playlist-panel')
  root.dataset.config = JSON.stringify(docConfig)
  root.dataset.state = 'loading'

  for (const entry of docConfig) {
    const card = document.createElement('article')
    card.dataset.playlistId = entry.id

    const cover = document.createElement('img')
    cover.setAttribute('data-cover', '')
    cover.alt = ''

    const details = document.createElement('div')
    details.setAttribute('data-details', '')

    const meta = document.createElement('span')
    meta.setAttribute('data-meta', '')
    meta.hidden = true
    const author = document.createElement('span')
    author.setAttribute('data-author', '')
    meta.append(author)

    const count = document.createElement('span')
    count.setAttribute('data-count', '')
    count.textContent = '—'

    const title = document.createElement('a')
    title.setAttribute('data-title', '')
    title.textContent = entry.title || entry.id

    const description = document.createElement('p')
    description.setAttribute('data-description', '')
    description.hidden = true

    const note = document.createElement('p')
    note.setAttribute('data-note', '')
    note.hidden = true

    const exportBtn = document.createElement('button')
    exportBtn.setAttribute('data-export', '')
    exportBtn.disabled = true

    details.append(meta, count, title, description, note, exportBtn)
    card.append(cover, details)
    root.append(card)
  }

  const status = document.createElement('p')
  status.setAttribute('data-status', '')
  status.textContent = '正在获取歌单…'
  const updated = document.createElement('time')
  updated.setAttribute('data-updated', '')
  updated.hidden = true
  root.append(status, updated)
  return root
}

test('mount keeps static details visible while loading, then fills count and export', async () => {
  const root = playlistRoot()
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => {
    await gate
    return { ok: true, json: async () => structuredClone(payload) }
  }
  try {
    const cleanup = mountPlaylists(root)
    assert.equal(root.dataset.state, 'loading')
    assert.equal(root.querySelector('[data-details]').hidden, false)
    assert.equal(root.querySelector('[data-export]').disabled, true)
    assert.equal(root.querySelector('[data-count]').textContent, '—')
    assert.equal(root.querySelector('[data-meta]').hidden, true)
    assert.equal(
      root.querySelector('[data-status]').textContent,
      '正在获取歌单…'
    )
    release()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(root.dataset.state, 'ready')
    assert.equal(root.querySelector('[data-details]').hidden, false)
    assert.equal(
      root.querySelector('[data-count]').textContent,
      String(songs.length)
    )
    assert.equal(root.querySelector('[data-meta]').hidden, false)
    assert.equal(root.querySelector('[data-export]').disabled, false)
    cleanup()
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('mount failure keeps static details and leaves export disabled', async () => {
  const root = playlistRoot()
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('network')
  }
  try {
    const cleanup = mountPlaylists(root)
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(root.dataset.state, 'failed')
    assert.equal(root.querySelector('[data-details]').hidden, false)
    assert.equal(root.querySelector('[data-export]').disabled, true)
    assert.match(
      root.querySelector('[data-status]').textContent,
      /暂时无法获取歌单数据/
    )
    cleanup()
  } finally {
    globalThis.fetch = previousFetch
  }
})
