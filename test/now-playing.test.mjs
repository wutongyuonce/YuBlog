import assert from 'node:assert/strict'
import test from 'node:test'
import { handleNowPlaying } from '../api/lastfm-now.js'
import { fetchLastfmNowPlaying } from '../src/utils/lastfm.mjs'
import { parseNowPlayingPayload } from '../src/utils/recent-listening.js'

const now = new Date('2026-11-08T08:00:00Z')
const apiKey = 'test-only-key'
const cover = 'https://lastfm-img.freetls.fastly.net/i/u/300x300/album.jpg'
const uts = (minutesAgo) => String(now.getTime() / 1000 - minutesAgo * 60)

const recent = (tracks) => async (url) => {
  assert.equal(url.searchParams.get('method'), 'user.getRecentTracks')
  assert.equal(url.searchParams.get('limit'), '6')
  return new Response(JSON.stringify({ recenttracks: { track: tracks } }))
}
const played = (name, extra = {}) => ({
  name,
  artist: { '#text': 'Gareth.T' },
  album: { '#text': '玻璃' },
  image: [{ '#text': cover }],
  date: { uts: uts(5) },
  ...extra,
})
const noFallback = async () => assert.fail('artwork is already available')

test('the first track may be playing; the rest are scrobbles with their time', async () => {
  const items = [
    played('Now', { '@attr': { nowplaying: 'true' }, 'date': undefined }),
    ...Array.from({ length: 6 }, (_, i) =>
      played(`Song ${i}`, { date: { uts: uts(10 * (i + 1)) } })
    ),
  ]
  const data = await fetchLastfmNowPlaying({
    apiKey,
    fetchImpl: recent(items),
    findCover: noFallback,
  })
  assert.equal(data.playing, true)
  assert.deepEqual(
    data.tracks.map((t) => [t.name, t.playedAt]),
    [
      ['Now', null],
      ...Array.from({ length: 5 }, (_, i) => [
        `Song ${i}`,
        new Date(Number(uts(10 * (i + 1))) * 1000).toISOString(),
      ]),
    ]
  )
  assert.equal(data.tracks[0].url, 'https://www.last.fm/music/Gareth.T/_/Now')
  assert.deepEqual(parseNowPlayingPayload(data), data)
})

test('without a playing track the latest scrobble leads with its time', async () => {
  const data = await fetchLastfmNowPlaying({
    apiKey,
    fetchImpl: recent([played('Latest', { date: { uts: uts(25) } })]),
    findCover: noFallback,
  })
  assert.equal(data.playing, false)
  assert.equal(
    data.tracks[0].playedAt,
    new Date(now.getTime() - 25 * 60_000).toISOString()
  )
})

test('tracks without Last.fm artwork try a NetEase song lookup once each', async () => {
  const lookups = []
  const data = await fetchLastfmNowPlaying({
    apiKey,
    fetchImpl: recent([
      played('A', { image: [] }),
      played('A', { image: [] }),
      played('B', { image: [] }),
    ]),
    findCover: async (query) => {
      lookups.push(query)
      return query.name === 'A'
        ? { cover: 'https://p1.music.126.net/a.jpg?param=300y300' }
        : null
    },
  })
  assert.deepEqual(
    lookups.map(({ kind, name, artist }) => [kind, name, artist]),
    [
      ['song', 'A', 'Gareth.T'],
      ['song', 'B', 'Gareth.T'],
    ]
  )
  assert.deepEqual(
    data.tracks.map((t) => t.cover),
    [
      'https://p1.music.126.net/a.jpg?param=300y300',
      'https://p1.music.126.net/a.jpg?param=300y300',
      null,
    ]
  )
})

test('an account with no history is a valid empty answer', async () => {
  const data = await fetchLastfmNowPlaying({ apiKey, fetchImpl: recent([]) })
  assert.deepEqual(data, { playing: false, tracks: [] })
  assert.deepEqual(parseNowPlayingPayload(data), data)
})

test('the endpoint caches successes for 30 seconds', async () => {
  const ok = await handleNowPlaying(
    new Request('https://blog.example/api/lastfm-now'),
    { apiKey, fetchImpl: recent([played('A')]), findCover: noFallback }
  )
  assert.equal(ok.status, 200)
  assert.match(ok.headers.get('cache-control'), /s-maxage=30\b/)
})
