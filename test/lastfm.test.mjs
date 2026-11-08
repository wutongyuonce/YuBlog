import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchLastfmSnapshot } from '../src/utils/lastfm.mjs'

const now = new Date('2026-10-10T12:00:00Z')
const apiKey = 'test-only-key'
const image = (id) => [
  { '#text': `https://lastfm-img.freetls.fastly.net/i/u/174s/${id}.jpg` },
  { '#text': `https://lastfm-img.freetls.fastly.net/i/u/300x300/${id}.jpg` },
]
const placeholder =
  'https://lastfm-img.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png'
const album = (name, artist = 'Artist', images = image(name), plays = '4') => ({
  name,
  artist: { name: artist },
  playcount: plays,
  image: images,
})

/** 假上游：每个时段一份专辑排行；`findCover` 记录网易云回退的查找。 */
const fixture = ({
  albums = () => [album('Album')],
  total = '1234',
  transform = (_method, data) => data,
  found = () => null,
} = {}) => {
  const requests = []
  const lookups = []
  const fetchImpl = async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal)
    const params = url.searchParams
    requests.push(Object.fromEntries(params))
    const method = params.get('method')
    let data
    if (method === 'user.getInfo') data = { user: { playcount: total } }
    else if (method === 'user.getTopAlbums') {
      const list = albums(params.get('period'))
      data = {
        topalbums: {
          'album': list,
          '@attr': { total: String(list.length * 3) },
        },
      }
    } else assert.fail(`Unexpected method: ${method}`)
    return new Response(JSON.stringify(transform(method, data)))
  }
  const findCover = async (query) => {
    lookups.push(query)
    return found(query)
  }
  return { apiKey, now, fetchImpl, findCover, requests, lookups }
}

test('each period carries its album total and at most nine ranked albums', async () => {
  const options = fixture({
    albums: (period) =>
      Array.from({ length: period === '7day' ? 1 : 12 }, (_, i) =>
        album(`${period} ${i}`)
      ),
  })
  const snapshot = await fetchLastfmSnapshot(options)
  assert.equal(snapshot.totalScrobbles, 1234)
  assert.equal(snapshot.updatedAt, now.toISOString())
  assert.deepEqual(
    snapshot.periods.map((p) => [p.key, p.albumTotal, p.albums.length]),
    [
      ['7day', 3, 1],
      ['1month', 36, 9],
      ['12month', 36, 9],
      ['overall', 36, 9],
    ]
  )
  assert.deepEqual(snapshot.periods[1].albums[0], {
    name: '1month 0',
    artist: 'Artist',
    playcount: 4,
    url: 'https://www.last.fm/music/Artist/1month%200',
    cover: 'https://lastfm-img.freetls.fastly.net/i/u/300x300/1month%200.jpg',
    coverLarge:
      'https://lastfm-img.freetls.fastly.net/i/u/600x600/1month%200.jpg',
  })
  const tops = options.requests.filter((r) => r.method === 'user.getTopAlbums')
  assert.deepEqual(
    tops.map((r) => [r.period, r.limit]),
    [
      ['7day', '9'],
      ['1month', '9'],
      ['12month', '9'],
      ['overall', '9'],
    ]
  )
  assert.equal(options.lookups.length, 0, 'Last.fm artwork needs no fallback')
  assert.ok(!JSON.stringify(snapshot).includes(apiKey))
})

test('missing artwork falls back to a sized NetEase cover, or stays empty', async () => {
  const fallback = {
    cover: 'https://p1.music.126.net/x.jpg?param=300y300',
    coverLarge: 'https://p1.music.126.net/x.jpg?param=600y600',
  }
  const options = fixture({
    // 同一张缺图专辑出现在四个时段里；另一张网易云也查不到。
    albums: () => [
      album('Shared', 'Artist', [{ '#text': placeholder }]),
      album('Unknown', 'Artist', [{ '#text': 'https://evil.example/a.jpg' }]),
    ],
    found: ({ name }) =>
      name === 'Shared' ? 'https://p1.music.126.net/x.jpg' : null,
  })
  const snapshot = await fetchLastfmSnapshot(options)
  for (const period of snapshot.periods) {
    assert.deepEqual(
      {
        cover: period.albums[0].cover,
        coverLarge: period.albums[0].coverLarge,
      },
      fallback
    )
    assert.equal(period.albums[1].cover, null)
    assert.equal(period.albums[1].coverLarge, null)
  }
  assert.deepEqual(
    [...new Set(options.lookups.map(({ kind, name }) => `${kind}:${name}`))],
    ['album:Shared', 'album:Unknown'],
    'every collage gap searches NetEase albums'
  )
})

test('cover fallbacks overlap within the concurrency budget', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  let active = 0
  let peak = 0
  const options = fixture({
    albums: (period) =>
      Array.from({ length: 9 }, (_, i) => album(`${period} ${i}`, 'A', [])),
    found: async () => {
      peak = Math.max(peak, ++active)
      await gate
      active--
      return null
    },
  })
  const pending = fetchLastfmSnapshot(options)
  for (let tick = 0; tick < 50 && options.lookups.length < 6; tick++)
    await new Promise(setImmediate)
  await new Promise(setImmediate)
  assert.equal(options.lookups.length, 6, 'no lookup starts beyond the limit')
  release()
  await pending
  assert.equal(peak, 6)
  assert.equal(options.lookups.length, 36)
})

test('a slow fallback stops waiting at the budget and keeps the gap', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const options = fixture({
    albums: () => [album('Slow', 'Artist', [])],
    // 永不结束的查找：只有总等待时限能让快照返回。
    found: () => new Promise(() => undefined),
  })
  const pending = fetchLastfmSnapshot(options)
  while (!options.lookups.length) await new Promise(setImmediate)
  t.mock.timers.tick(2_500)
  const snapshot = await pending
  assert.ok(snapshot.periods.every((p) => p.albums[0].cover === null))
})

test('an empty library is a valid answer', async () => {
  const snapshot = await fetchLastfmSnapshot(
    fixture({ albums: () => [], total: '0' })
  )
  assert.equal(snapshot.totalScrobbles, 0)
  assert.ok(
    snapshot.periods.every((p) => p.albumTotal === 0 && p.albums.length === 0)
  )
})

test('API errors and malformed fields fail without exposing credentials', async () => {
  for (const options of [
    fixture({
      transform: (method, data) =>
        method === 'user.getInfo' ? { error: 10, message: apiKey } : data,
    }),
    fixture({ total: 'not-a-count' }),
    fixture({ albums: () => [album('')] }),
    fixture({ albums: () => [album('A', 'B', [], '-1')] }),
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
