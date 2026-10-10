import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fetchLastfmSnapshot } from '../scripts/lib/lastfm.mjs'
import { syncLastfm } from '../scripts/sync-lastfm.mjs'

const now = new Date('2026-10-10T12:00:00Z')
const apiKey = 'test-only-key'
const cover = 'https://lastfm-img.freetls.fastly.net/i/u/300x300/album.jpg'
const placeholder =
  'https://lastfm-img.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png'
const track = (name = 'Song', artist = 'Artist') => ({
  name,
  artist: { name: artist },
  playcount: '4',
})
const played = (name = 'Song', artist = 'Artist', album = 'Album') => ({
  name,
  artist: { '#text': artist },
  album: { '#text': album },
  image: [{ '#text': cover, 'size': 'extralarge' }],
  date: { uts: String(now.getTime() / 1000 - 60) },
})

const fixture = ({
  tracks = [track()],
  pages = [[played()]],
  weekly = '42',
  total = '1234',
  artists = [{ name: 'Favourite Artist' }],
  albumInfo = () => ({ album: { image: [] } }),
  transform = (_method, data) => data,
} = {}) => {
  const requests = []
  const fetchImpl = async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal)
    const params = url.searchParams
    requests.push(Object.fromEntries(params))
    const method = params.get('method')
    let data
    if (method === 'user.getTopTracks') data = { toptracks: { track: tracks } }
    else if (method === 'user.getInfo') data = { user: { playcount: total } }
    else if (method === 'user.getTopArtists')
      data = { topartists: { artist: artists } }
    else if (method === 'user.getRecentTracks')
      data = {
        recenttracks: {
          '@attr': { total: weekly, totalPages: String(pages.length) },
          'track': pages[Number(params.get('page')) - 1] || [],
        },
      }
    else if (method === 'album.getInfo') data = albumInfo(params.get('album'))
    else assert.fail(`Unexpected method: ${method}`)
    return new Response(JSON.stringify(transform(method, data)))
  }
  return { apiKey, now, fetchImpl, requests }
}

test('seven-day statistics count the full library, not just the displayed Top 10', async () => {
  const options = fixture({
    tracks: Array.from({ length: 12 }, (_, i) => track(`Song ${i}`)),
  })
  const snapshot = await fetchLastfmSnapshot(options)
  assert.equal(snapshot.tracks.length, 10)
  assert.deepEqual(
    snapshot.tracks.map(({ name }) => name),
    Array.from({ length: 10 }, (_, i) => `Song ${i}`)
  )
  assert.equal(snapshot.weeklyScrobbles, 42)
  assert.equal(snapshot.totalScrobbles, 1234)
  assert.equal(snapshot.topArtist, 'Favourite Artist')
  assert.equal(snapshot.updatedAt, now.toISOString())
  for (const method of ['user.getTopTracks', 'user.getTopArtists'])
    assert.equal(
      options.requests.find((r) => r.method === method).period,
      '7day'
    )
  const recent = options.requests.find(
    (r) => r.method === 'user.getRecentTracks'
  )
  assert.equal(Number(recent.to) - Number(recent.from), 604800)
  assert.equal(Number(recent.to), now.getTime() / 1000)
  assert.equal(recent.limit, '200')
  assert.ok(!JSON.stringify(snapshot).includes(apiKey))
})

test('album metadata uses the newest recorded match for both song and artist, across pages', async () => {
  const playing = {
    ...played('Song', 'Artist', 'Playing album'),
    '@attr': { nowplaying: 'true' },
  }
  delete playing.date
  const outside = played('Song', 'Artist', 'Outside week')
  outside.date.uts = String(now.getTime() / 1000 - 604801)
  const options = fixture({
    pages: [
      [playing, outside, played('Song', 'Other Artist', 'Wrong album')],
      [
        played('Song', 'Artist', 'Correct album'),
        played('Song', 'Artist', 'Older album'),
      ],
    ],
  })
  const { tracks } = await fetchLastfmSnapshot(options)
  assert.equal(tracks[0].album, 'Correct album')
  assert.equal(tracks[0].cover, cover)
  assert.equal(tracks[0].fullCover, cover.replace('/300x300/', '/ar0/'))
  assert.equal(
    options.requests.filter((r) => r.method === 'user.getRecentTracks').length,
    2
  )
  assert.equal(
    options.requests.filter((r) => r.method === 'album.getInfo').length,
    0
  )
})

test('missing artwork can use a base album cover while retaining the scrobbled edition name', async () => {
  const missing = played('Song', 'Artist', 'Album (Deluxe Version)')
  missing.image = [{ '#text': placeholder }, { '#text': 'javascript:bad' }]
  const options = fixture({
    pages: [[missing]],
    albumInfo: (name) => ({
      album: { image: [{ '#text': name === 'Album' ? cover : placeholder }] },
    }),
  })
  const { tracks } = await fetchLastfmSnapshot(options)
  assert.equal(tracks[0].album, 'Album (Deluxe Version)')
  assert.equal(tracks[0].cover, cover)
  assert.deepEqual(
    options.requests
      .filter((r) => r.method === 'album.getInfo')
      .map((r) => r.album),
    ['Album (Deluxe Version)', 'Album']
  )
})

test('catalogue gaps keep real track text and a null cover without inventing artwork', async () => {
  const missing = played()
  missing.image = [{ '#text': 'https://untrusted.example/cover.jpg' }]
  const options = fixture({
    pages: [[missing]],
    albumInfo: () => ({ error: 6 }),
  })
  const snapshot = await fetchLastfmSnapshot(options)
  assert.equal(snapshot.tracks[0].cover, null)
  assert.equal(snapshot.tracks[0].fullCover, null)
  assert.equal(snapshot.tracks[0].album, 'Album')
  const empty = await fetchLastfmSnapshot(
    fixture({ tracks: [], pages: [[]], artists: [], weekly: '0', total: '0' })
  )
  assert.deepEqual(empty.tracks, [])
  assert.equal(empty.topArtist, null)
  assert.equal(empty.weeklyScrobbles, 0)
  assert.equal(empty.totalScrobbles, 0)
})

test('metadata scans stop at ten pages and preserve the complete ranking and total', async () => {
  const options = fixture({ pages: Array.from({ length: 11 }, () => []) })
  const snapshot = await fetchLastfmSnapshot(options)
  assert.equal(snapshot.tracks.length, 1)
  assert.equal(snapshot.tracks[0].album, null)
  assert.equal(snapshot.weeklyScrobbles, 42)
  assert.equal(
    options.requests.filter((r) => r.method === 'user.getRecentTracks').length,
    10
  )
})

test('API errors and malformed counts fail without exposing credentials or upstream messages', async () => {
  for (const options of [
    fixture({
      transform: (method, data) =>
        method === 'user.getInfo' ? { error: 10, message: apiKey } : data,
    }),
    fixture({ weekly: 'not-a-count' }),
    {
      apiKey,
      now,
      fetchImpl: async () => {
        throw new Error(`URL with ${apiKey}`)
      },
    },
    { apiKey, now, fetchImpl: async () => new Response('{}', { status: 503 }) },
  ]) {
    await assert.rejects(fetchLastfmSnapshot(options), (error) => {
      assert.match(error.message, /Last.fm:/)
      assert.ok(!error.message.includes(apiKey))
      return true
    })
  }
  await assert.rejects(fetchLastfmSnapshot({ now }), /LASTFM_API_KEY/)
})

test('a failed refresh leaves the successful on-disk snapshot intact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lastfm-'))
  const destination = join(directory, 'lastfm.json')
  try {
    await writeFile(destination, 'previous snapshot\n')
    await assert.rejects(
      syncLastfm({ ...fixture({ total: '-1' }), destination })
    )
    assert.equal(await readFile(destination, 'utf8'), 'previous snapshot\n')
    const successful = await syncLastfm({ ...fixture(), destination })
    assert.deepEqual(
      JSON.parse(await readFile(destination, 'utf8')),
      successful
    )
    assert.deepEqual(await readdir(directory), ['lastfm.json'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
