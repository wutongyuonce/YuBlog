import assert from 'node:assert/strict'
import test from 'node:test'
import { handleNowPlaying } from '../api/lastfm-now.js'
import { fetchLastfmNowPlaying } from '../src/utils/lastfm.mjs'
import {
  parseNowPlayingPayload,
  playedAgoLabel,
} from '../src/utils/recent-listening.js'

const now = new Date('2026-11-08T08:00:00Z')
const apiKey = 'test-only-key'
const cover = 'https://lastfm-img.freetls.fastly.net/i/u/300x300/album.jpg'

const recent = (track) => async (url) => {
  assert.equal(url.searchParams.get('method'), 'user.getRecentTracks')
  assert.equal(url.searchParams.get('limit'), '1')
  return new Response(
    JSON.stringify({ recenttracks: { track: track ? [track] : [] } })
  )
}
const played = (extra = {}) => ({
  name: '玻璃',
  artist: { '#text': 'Gareth.T' },
  album: { '#text': '玻璃' },
  image: [{ '#text': cover }],
  ...extra,
})

test('a track flagged nowplaying is reported as playing without a time', async () => {
  const data = await fetchLastfmNowPlaying({
    apiKey,
    fetchImpl: recent(played({ '@attr': { nowplaying: 'true' } })),
  })
  assert.equal(data.playing, true)
  assert.equal(data.playedAt, null)
  assert.equal(data.track.name, '玻璃')
  assert.equal(data.track.cover, cover)
  assert.deepEqual(parseNowPlayingPayload(data), {
    playing: true,
    playedAt: null,
    track: { ...data.track },
  })
})

test('otherwise the latest scrobble is reported with when it played', async () => {
  const uts = now.getTime() / 1000 - 25 * 60
  const data = await fetchLastfmNowPlaying({
    apiKey,
    fetchImpl: recent(played({ date: { uts: String(uts) } })),
  })
  assert.equal(data.playing, false)
  assert.equal(data.playedAt, new Date(uts * 1000).toISOString())
  assert.equal(playedAgoLabel(data.playedAt, now), '25 分钟前')
})

test('an account with no history is a valid empty answer', async () => {
  const data = await fetchLastfmNowPlaying({
    apiKey,
    fetchImpl: recent(null),
  })
  assert.equal(data.track, null)
  assert.deepEqual(parseNowPlayingPayload(data), {
    playing: false,
    playedAt: null,
    track: null,
  })
})

test('malformed answers are rejected as a whole', () => {
  const track = { name: 'A', artist: 'B', url: 'https://www.last.fm/x' }
  assert.equal(parseNowPlayingPayload({ playing: 'yes', track }), null)
  assert.equal(parseNowPlayingPayload({ playing: false, track }), null)
  assert.equal(
    parseNowPlayingPayload({
      playing: true,
      track: { ...track, url: 'http://insecure' },
    }),
    null
  )
})

test('relative labels step from minutes to hours to days', () => {
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

test('the endpoint caches successes for 30 seconds', async () => {
  const ok = await handleNowPlaying(
    new Request('https://blog.example/api/lastfm-now'),
    {
      apiKey,
      fetchImpl: recent(played({ '@attr': { nowplaying: 'true' } })),
    }
  )
  assert.equal(ok.status, 200)
  assert.match(ok.headers.get('cache-control'), /s-maxage=30\b/)
})
