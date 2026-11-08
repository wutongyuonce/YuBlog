import assert from 'node:assert/strict'
import test from 'node:test'
import {
  listeningUpdatedLabel,
  parseListeningPayload,
  parseNowPlayingPayload,
  playedAgoLabel,
  renderListening,
  renderNowPlaying,
} from '../src/utils/recent-listening.js'
import { createDocument } from '../test-support/minimal-dom.mjs'

const album = (overrides = {}) => ({
  name: '玻璃',
  artist: 'Gareth.T',
  url: 'https://www.last.fm/music/Gareth.T/%E7%8E%BB%E7%92%83',
  playcount: 7,
  cover: 'https://lastfm-img.freetls.fastly.net/i/u/300x300/a.jpg',
  coverLarge: 'https://lastfm-img.freetls.fastly.net/i/u/600x600/a.jpg',
  ...overrides,
})
const keys = ['7day', '1month', '12month', 'overall']
const payload = ({ albums = () => [album()], ...overrides } = {}) => ({
  updatedAt: '2026-10-15T07:29:23.000Z',
  totalScrobbles: 8918,
  periods: keys.map((key) => ({ key, albumTotal: 27, albums: albums(key) })),
  ...overrides,
})

test('a complete answer becomes the shape the section renders', () => {
  const snapshot = parseListeningPayload(payload())
  assert.equal(snapshot.totalScrobbles, 8918)
  assert.deepEqual(
    snapshot.periods.map((p) => p.key),
    keys
  )
  assert.deepEqual(snapshot.periods[0].albums, [album()])
})

test('missing or unsafe artwork is a gap, never a substituted value', () => {
  const snapshot = parseListeningPayload(
    payload({
      albums: () => [
        album({ cover: null, coverLarge: null }),
        album({ cover: 'http://insecure/a.jpg' }),
      ],
    })
  )
  for (const item of snapshot.periods[0].albums) {
    assert.equal(item.cover, null)
    assert.equal(item.coverLarge, null)
  }
})

test('any malformed field rejects the whole answer instead of rendering part of it', () => {
  const broken = [
    null,
    [],
    payload({ updatedAt: 'whenever' }),
    payload({ totalScrobbles: '1' }),
    payload({ periods: payload().periods.slice(1) }),
    payload({ periods: [...payload().periods].reverse() }),
    payload({ albums: () => [null] }),
    payload({ albums: () => [album({ name: ' ' })] }),
    payload({ albums: () => [album({ url: 'javascript:alert(1)' })] }),
    payload({ albums: () => [album({ playcount: 1.5 })] }),
  ]
  for (const value of broken)
    assert.equal(
      parseListeningPayload(value),
      null,
      JSON.stringify(value)?.slice(0, 80)
    )
})

test('malformed now-playing answers are rejected as a whole', () => {
  const track = {
    name: 'A',
    artist: 'B',
    album: null,
    cover: null,
    url: 'https://www.last.fm/x',
    playedAt: '2026-11-08T08:00:00.000Z',
  }
  for (const value of [
    { playing: 'yes', tracks: [track] },
    { playing: true, tracks: [] },
    { playing: false, tracks: [{ ...track, playedAt: null }] },
    // 正在播放时第一首不带时间，其后的每首都必须带。
    {
      playing: true,
      tracks: [
        { ...track, playedAt: null },
        { ...track, playedAt: null },
      ],
    },
    { playing: true, tracks: [track] },
    { playing: false, tracks: [{ ...track, url: 'http://insecure' }] },
    { playing: false, tracks: null },
  ])
    assert.equal(parseNowPlayingPayload(value), null, JSON.stringify(value))
})

test('relative labels step from minutes to hours to days', () => {
  const now = new Date('2026-11-08T08:00:00Z')
  const ago = (minutes) =>
    playedAgoLabel(
      new Date(now.getTime() - minutes * 60_000).toISOString(),
      now
    )
  assert.equal(ago(0), '刚刚')
  assert.equal(ago(59), '59 分钟前')
  assert.equal(ago(60 * 5), '5 小时前')
  assert.equal(ago(60 * 24 * 3), '3 天前')
})

function collageRoot() {
  const document = createDocument()
  const root = document.createElement('section')
  root.dataset.state = 'loading'
  for (const key of keys) {
    const button = document.createElement('button')
    button.setAttribute('data-listening-period', key)
    root.append(button)
  }
  const pick = {}
  for (const [name, tag] of [
    ['total', 'strong'],
    ['grid', 'div'],
    ['summary', 'p'],
    ['time', 'time'],
    ['message', 'p'],
  ]) {
    pick[name] = document.createElement(tag)
    pick[name].setAttribute(`data-listening-${name}`, '')
    root.append(pick[name])
  }
  for (let i = 0; i < 9; i++) pick.grid.append(document.createElement('span'))
  return { root, ...pick }
}

test('the chosen period fills the collage, its summary and the period switch', () => {
  const snapshot = parseListeningPayload(
    payload({
      albums: (key) =>
        key === '1month'
          ? Array.from({ length: 9 }, (_, i) =>
              album({
                name: `专辑 ${i + 1}`,
                playcount: 10 - i,
                ...(i === 2 ? { cover: null, coverLarge: null } : {}),
              })
            )
          : [album()],
    })
  )
  const { root, grid, summary, total, time } = collageRoot()
  renderListening(root, snapshot, '1month')
  assert.equal(root.dataset.state, 'ready')
  assert.equal(total.textContent, '8,918')
  assert.equal(grid.children.length, 9)
  const [lead, second, third] = grid.children
  assert.match(lead.className, /collage__tile--lead/)
  assert.equal(
    lead.querySelector('img').src,
    'https://lastfm-img.freetls.fastly.net/i/u/600x600/a.jpg',
    'the 2×2 tile uses the large cover'
  )
  assert.equal(lead.querySelector('.collage__kicker').textContent, '#1 · 30 天')
  assert.equal(
    second.querySelector('.collage__kicker').textContent,
    '#2 · 9 次'
  )
  assert.equal(
    second.getAttribute('aria-label'),
    '第 2：专辑 2 — Gareth.T，9 次播放'
  )
  assert.ok(third.hasAttribute('data-no-cover'))
  assert.equal(third.querySelector('img'), null)
  assert.equal(third.querySelector('.collage__name').textContent, '专辑 3')
  assert.equal(third.querySelector('.collage__artist').textContent, 'Gareth.T')
  assert.equal(summary.textContent, '30 天里听了 27 张专辑 · 这 9 张共 54 次')
  assert.equal(
    time.textContent,
    `更新于 ${listeningUpdatedLabel(snapshot.updatedAt)}`
  )
  assert.deepEqual(
    root
      .querySelectorAll('[data-listening-period]')
      .map((b) => b.getAttribute('aria-pressed')),
    ['false', 'true', 'false', 'false']
  )

  renderListening(root, snapshot, 'overall')
  assert.equal(
    grid.children.length,
    1,
    'fewer than nine albums leave the rest empty'
  )
  assert.equal(summary.textContent, '一共听了 27 张专辑 · 这 1 张共 7 次')
})

test('empty periods, an empty library and failures each get their own state', () => {
  const sparse = parseListeningPayload(
    payload({ albums: (key) => (key === '7day' ? [] : [album()]) })
  )
  const cases = [
    [sparse, '7day', 'period-empty', '7 天里还没有听歌记录。'],
    [
      parseListeningPayload(payload({ albums: () => [] })),
      '1month',
      'empty',
      '还没有听歌记录。',
    ],
    [null, '1month', 'error', '暂时无法获取听歌数据。'],
  ]
  for (const [snapshot, period, state, text] of cases) {
    const { root, grid, message, summary } = collageRoot()
    renderListening(root, snapshot, period)
    assert.equal(root.dataset.state, state)
    assert.equal(root.getAttribute('aria-busy'), 'false')
    assert.equal(grid.children.length, 0, 'skeletons never linger')
    assert.equal(summary.textContent, '')
    assert.equal(message.textContent, text)
    assert.equal(message.hidden, false)
    assert.ok(
      root
        .querySelectorAll('[data-listening-period]')
        .every((button) => button.disabled === (state === 'error')),
      'periods can be switched once any snapshot arrives'
    )
  }
})

function nowBlock() {
  const document = createDocument()
  const block = document.createElement('div')
  block.dataset.state = 'loading'
  for (const [name, tag] of [
    ['status', 'span'],
    ['title', 'a'],
    ['artist', 'p'],
    ['album', 'p'],
    ['cover', 'img'],
    ['ambient', 'img'],
    ['list', 'ol'],
  ]) {
    const node = document.createElement(tag)
    node.setAttribute(`data-np-${name}`, '')
    block.append(node)
  }
  return block
}

test('the latest track fills the card and the next ones form the timed list', () => {
  const now = new Date('2026-11-08T08:00:00Z')
  const ago = (minutes) => new Date(now - minutes * 60_000).toISOString()
  const track = (name, minutes, cover = 'https://p1.music.126.net/a.jpg') => ({
    name,
    artist: 'YOASOBI',
    album: 'THE BOOK 3',
    cover,
    url: `https://www.last.fm/music/YOASOBI/_/${name}`,
    playedAt: minutes == null ? null : ago(minutes),
  })
  const data = parseNowPlayingPayload({
    playing: true,
    tracks: [
      track('祝福', null),
      track('勇者', 30, null),
      track('アイドル', 60 * 24 * 13),
    ],
  })
  const block = nowBlock()
  renderNowPlaying(block, data, now)
  assert.equal(block.dataset.state, 'playing')
  assert.equal(block.querySelector('[data-np-status]').textContent, '正在播放')
  assert.equal(block.querySelector('[data-np-title]').textContent, '祝福')
  const rows = block.querySelector('[data-np-list]').children
  assert.deepEqual(
    rows.map((row) => [
      row.querySelector('.recent-tracks__title').textContent,
      row.querySelector('.recent-tracks__artist').textContent,
      row.querySelector('time').textContent,
    ]),
    [
      ['勇者', 'YOASOBI', '30 分钟前'],
      ['アイドル', 'YOASOBI', '13 天前'],
    ]
  )
  assert.equal(
    rows[0].querySelector('img'),
    null,
    'a missing cover keeps the note'
  )
  assert.equal(block.hasAttribute('data-solo'), false)

  renderNowPlaying(block, null, now)
  assert.equal(
    block.dataset.state,
    'playing',
    'a failed poll keeps the last answer'
  )
  assert.equal(block.querySelector('[data-np-list]').children.length, 2)

  const fresh = nowBlock()
  renderNowPlaying(
    fresh,
    parseNowPlayingPayload({ playing: false, tracks: [] })
  )
  assert.equal(fresh.hidden, true)
  assert.equal(fresh.dataset.state, 'empty')
})
