import assert from 'node:assert/strict'
import test from 'node:test'
import {
  listeningStats,
  listeningUpdatedLabel,
  parseListeningPayload,
  renderListening,
} from '../src/utils/recent-listening.js'
import { createDocument } from '../test-support/minimal-dom.mjs'

const track = (overrides = {}) => ({
  name: '玻璃',
  artist: 'Gareth.T',
  album: '玻璃',
  cover: 'https://lastfm-img.freetls.fastly.net/i/u/300x300/album.jpg',
  fullCover: 'https://lastfm-img.freetls.fastly.net/i/u/ar0/album.jpg',
  url: 'https://www.last.fm/music/Gareth.T/_/%E7%8E%BB%E7%92%83',
  playcount: 7,
  ...overrides,
})

const payload = (overrides = {}) => ({
  updatedAt: '2026-10-15T07:29:23.000Z',
  weeklyScrobbles: 39,
  totalScrobbles: 219,
  topArtist: 'Gareth.T',
  tracks: [track()],
  ...overrides,
})

test('a complete answer becomes the shape the section renders', () => {
  const snapshot = parseListeningPayload(payload())
  assert.equal(snapshot.weeklyScrobbles, 39)
  assert.equal(snapshot.totalScrobbles, 219)
  assert.equal(snapshot.topArtist, 'Gareth.T')
  assert.deepEqual(snapshot.tracks, [track()])
})

test('missing album or artwork stays a real gap, not a substituted value', () => {
  const snapshot = parseListeningPayload(
    payload({
      topArtist: null,
      tracks: [track({ album: null, cover: null, fullCover: null })],
    })
  )
  assert.equal(snapshot.topArtist, null)
  assert.equal(snapshot.tracks[0].album, null)
  assert.equal(snapshot.tracks[0].cover, null)
})

test('no listening in the window is a valid empty answer', () => {
  const snapshot = parseListeningPayload(
    payload({
      weeklyScrobbles: 0,
      totalScrobbles: 0,
      topArtist: null,
      tracks: [],
    })
  )
  assert.deepEqual(snapshot.tracks, [])
  assert.equal(snapshot.weeklyScrobbles, 0)
})

test('the section never renders more than ten cards, even from a longer answer', () => {
  const tracks = Array.from({ length: 12 }, (_, index) =>
    track({ name: `Song ${index}` })
  )
  const snapshot = parseListeningPayload(payload({ tracks }))
  assert.equal(snapshot.tracks.length, 10)
  assert.deepEqual(
    snapshot.tracks.map(({ name }) => name),
    Array.from({ length: 10 }, (_, index) => `Song ${index}`)
  )
})

test('any malformed field rejects the whole answer instead of rendering part of it', () => {
  // 只校验页面能渲染的形状；封面和图链的来源属于适配器的义务，这里不重复判断。
  const broken = [
    null,
    [],
    'not json',
    payload({ updatedAt: 'whenever' }),
    payload({ updatedAt: null }),
    payload({ weeklyScrobbles: -1 }),
    payload({ totalScrobbles: '219' }),
    payload({ totalScrobbles: 1.5 }),
    payload({ tracks: null }),
    payload({ tracks: [null] }),
    payload({ tracks: [track({ name: '' })] }),
    payload({ tracks: [track({ artist: '   ' })] }),
    payload({ tracks: [track({ url: 'http://www.last.fm/music/x' })] }),
    payload({ tracks: [track({ url: 'javascript:alert(1)' })] }),
    payload({ tracks: [track({ playcount: '7' })] }),
  ]
  for (const value of broken)
    assert.equal(
      parseListeningPayload(value),
      null,
      `rejected: ${JSON.stringify(value)?.slice(0, 60)}`
    )
})

test('statistics and the update time use one fixed presentation', () => {
  const snapshot = parseListeningPayload(payload())
  assert.deepEqual(listeningStats(snapshot), ['39', '219', 'Gareth.T'])
  assert.deepEqual(
    listeningStats(parseListeningPayload(payload({ topArtist: null }))),
    ['39', '219', '暂无']
  )
  assert.equal(listeningUpdatedLabel(snapshot.updatedAt), '10/15 15:29')
})

function listeningRoot({ skeletons = 10 } = {}) {
  const document = createDocument()
  const root = document.createElement('section')
  root.dataset.state = 'loading'
  root.setAttribute('aria-busy', 'true')

  for (const _ of [0, 1, 2]) {
    const stat = document.createElement('strong')
    stat.setAttribute('data-listening-stat', '')
    stat.textContent = '—'
    root.append(stat)
  }

  const track = document.createElement('div')
  track.setAttribute('data-listening-track', '')
  for (let i = 0; i < skeletons; i++) {
    const skeleton = document.createElement('article')
    skeleton.className = 'recent-listening__skeleton'
    skeleton.setAttribute('aria-hidden', 'true')
    skeleton.setAttribute('data-listening-skeleton', '')
    track.append(skeleton)
  }
  root.append(track)

  const template = document.createElement('template')
  template.setAttribute('data-listening-card', '')
  const card = document.createElement('article')
  card.className = 'media-card media-card--square'
  const view = document.createElement('div')
  view.className = 'image-view'
  const cover = document.createElement('img')
  cover.className = 'media-card__cover'
  view.append(cover)
  const source = document.createElement('template')
  source.className = 'image-view__source'
  source.content.append(document.createElement('img'))
  view.append(source)
  card.append(view)
  const body = document.createElement('div')
  body.className = 'media-card__body'
  const title = document.createElement('a')
  title.className = 'media-card__title'
  const meta = document.createElement('p')
  meta.className = 'media-card__meta'
  body.append(title, meta)
  card.append(body)
  template.content.append(card)
  root.append(template)

  const time = document.createElement('time')
  time.setAttribute('data-listening-time', '')
  time.textContent = '—'
  root.append(time)

  const message = document.createElement('p')
  message.setAttribute('data-listening-message', '')
  message.toggleAttribute('hidden', true)
  root.append(message)

  return { root, track }
}

test('renderListening replaces loading skeletons with real cards', () => {
  const snapshot = parseListeningPayload(
    payload({
      tracks: [
        track({ name: 'A' }),
        track({ name: 'B', cover: null, fullCover: null }),
      ],
    })
  )
  const { root, track: railTrack } = listeningRoot({ skeletons: 10 })
  assert.equal(
    railTrack.querySelectorAll('[data-listening-skeleton]').length,
    10
  )

  renderListening(root, snapshot)

  assert.equal(
    railTrack.querySelectorAll('[data-listening-skeleton]').length,
    0
  )
  assert.equal(railTrack.querySelectorAll('.media-card').length, 2)
  assert.equal(root.dataset.state, 'ready')
  assert.equal(root.getAttribute('aria-busy'), 'false')
  assert.equal(
    railTrack.querySelectorAll('.media-card__title')[0].textContent,
    'A'
  )
  assert.ok(
    railTrack.querySelectorAll('.recent-listening__placeholder')[0],
    'missing cover still uses the note placeholder'
  )
})

test('renderListening clears skeletons for empty and error states', () => {
  for (const snapshot of [
    parseListeningPayload(
      payload({ tracks: [], weeklyScrobbles: 0, topArtist: null })
    ),
    null,
  ]) {
    const { root, track: railTrack } = listeningRoot({ skeletons: 10 })
    renderListening(root, snapshot)
    assert.equal(railTrack.children.length, 0)
    assert.equal(
      railTrack.querySelectorAll('[data-listening-skeleton]').length,
      0
    )
    assert.equal(root.getAttribute('aria-busy'), 'false')
    assert.equal(root.dataset.state, snapshot ? 'empty' : 'error')
  }
})
