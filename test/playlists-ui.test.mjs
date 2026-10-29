import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mountPlaylists,
  parsePlaylistsPayload,
  playlistText,
} from '../src/utils/playlists-ui.js'

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

/** Minimal card tree for mountPlaylists loading／ready／failed visibility. */
function playlistRoot(docConfig = config) {
  const el = (tag, attrs = {}) => {
    const node = {
      tagName: tag.toUpperCase(),
      childNodes: [],
      attributes: { ...attrs },
      listeners: [],
      parentNode: null,
      isConnected: true,
      get children() {
        return this.childNodes.filter((c) => c.nodeType === 1)
      },
      get textContent() {
        return this.childNodes
          .map((c) => (c.nodeType === 3 ? c.data : (c.textContent ?? '')))
          .join('')
      },
      set textContent(value) {
        this.childNodes = []
        if (value !== '' && value != null)
          this.childNodes.push({ nodeType: 3, data: String(value) })
      },
      get hidden() {
        return Object.hasOwn(this.attributes, 'hidden')
      },
      set hidden(value) {
        if (value) this.attributes.hidden = ''
        else delete this.attributes.hidden
      },
      get disabled() {
        return Object.hasOwn(this.attributes, 'disabled')
      },
      set disabled(value) {
        if (value) this.attributes.disabled = ''
        else delete this.attributes.disabled
      },
      get dataset() {
        const self = this
        return new Proxy(
          {},
          {
            get(_, key) {
              if (typeof key !== 'string') return undefined
              const name = `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
              return self.attributes[name]
            },
            set(_, key, value) {
              if (typeof key !== 'string') return false
              const name = `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
              self.attributes[name] = String(value)
              return true
            },
          }
        )
      },
      setAttribute(name, value) {
        this.attributes[name] = String(value)
      },
      getAttribute(name) {
        return Object.hasOwn(this.attributes, name)
          ? this.attributes[name]
          : null
      },
      hasAttribute(name) {
        return Object.hasOwn(this.attributes, name)
      },
      append(...nodes) {
        for (const child of nodes) {
          child.parentNode = this
          this.childNodes.push(child)
        }
      },
      remove() {
        if (!this.parentNode) return
        this.parentNode.childNodes = this.parentNode.childNodes.filter(
          (n) => n !== this
        )
        this.parentNode = null
      },
      addEventListener(type, handler, options) {
        this.listeners.push({ type, handler, options })
      },
      querySelector(selector) {
        return this.querySelectorAll(selector)[0] ?? null
      },
      querySelectorAll(selector) {
        const found = []
        const walk = (current) => {
          for (const child of current.children ?? []) {
            if (match(child, selector)) found.push(child)
            walk(child)
          }
        }
        walk(this)
        return found
      },
    }
    if (tag === 'time') {
      Object.defineProperty(node, 'dateTime', {
        get() {
          return this.attributes.datetime ?? ''
        },
        set(value) {
          this.attributes.datetime = String(value)
        },
      })
    }
    if (tag === 'img') {
      Object.defineProperty(node, 'alt', {
        get() {
          return this.attributes.alt ?? ''
        },
        set(value) {
          this.attributes.alt = String(value)
        },
      })
    }
    node.nodeType = 1
    return node
  }

  const match = (node, selector) => {
    if (selector.startsWith('[') && selector.endsWith(']')) {
      return node.hasAttribute(selector.slice(1, -1))
    }
    return false
  }

  const root = el('playlist-panel')
  root.dataset.config = JSON.stringify(docConfig)
  root.dataset.state = 'loading'

  for (const entry of docConfig) {
    const card = el('article')
    card.dataset.playlistId = entry.id
    const title = el('a')
    title.setAttribute('data-title', '')
    title.textContent = entry.title || entry.id
    const cover = el('img')
    cover.setAttribute('data-cover', '')
    cover.alt = ''
    const meta = el('span')
    meta.setAttribute('data-meta', '')
    meta.hidden = true
    const author = el('span')
    author.setAttribute('data-author', '')
    meta.append(author)
    const count = el('span')
    count.setAttribute('data-count', '')
    count.textContent = '—'
    const description = el('p')
    description.setAttribute('data-description', '')
    description.hidden = true
    const note = el('p')
    note.setAttribute('data-note', '')
    note.hidden = true
    const exportBtn = el('button')
    exportBtn.setAttribute('data-export', '')
    exportBtn.disabled = true
    const details = el('div')
    details.setAttribute('data-details', '')
    details.append(meta, count, title, description, note, exportBtn)
    const skeleton = el('div')
    skeleton.setAttribute('data-skeleton', '')
    skeleton.hidden = true
    card.append(cover, details, skeleton)
    root.append(card)
  }

  const status = el('p')
  status.setAttribute('data-status', '')
  status.textContent = '正在获取歌单…'
  const updated = el('time')
  updated.setAttribute('data-updated', '')
  updated.hidden = true
  root.append(status, updated)
  return root
}

test('mount keeps static details visible and skeleton hidden while loading', async () => {
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
    assert.equal(root.querySelector('[data-skeleton]').hidden, true)
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
    assert.equal(root.querySelector('[data-skeleton]').hidden, true)
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
    assert.equal(root.querySelector('[data-skeleton]').hidden, true)
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
