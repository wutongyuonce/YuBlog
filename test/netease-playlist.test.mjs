import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchNeteasePlaylist } from '../src/utils/netease-playlist.mjs'

const first = {
  name: '玻璃',
  artists: [{ name: 'Gareth.T' }, { name: '另一位歌手' }],
  album: { name: '玻璃' },
}
const result = {
  name: '夜间随听',
  description: '安静的夜晚。',
  creator: { nickname: '测试作者' },
  trackCount: 2,
  tracks: [first, { name: '无专辑', artists: [], album: null }],
}
const response = (value = result) =>
  new Response(JSON.stringify({ code: 200, result: value }))

test('fetch normalizes metadata and songs in their original order in one request', async () => {
  const now = new Date('2026-10-28T02:00:00Z')
  let calls = 0
  const data = await fetchNeteasePlaylist('3778678', {
    now,
    fetchImpl: async (url, options) => {
      calls++
      assert.equal(url.origin, 'https://music.163.com')
      assert.equal(url.pathname, '/api/playlist/detail')
      assert.equal(url.searchParams.get('id'), '3778678')
      assert.equal(options.headers.referer, 'https://music.163.com/')
      assert.ok(options.signal instanceof AbortSignal)
      return response()
    },
  })
  assert.equal(calls, 1)
  assert.deepEqual(data, {
    title: '夜间随听',
    author: '测试作者',
    description: '安静的夜晚。',
    songCount: 2,
    songs: [
      { title: '玻璃', artist: 'Gareth.T / 另一位歌手', album: '玻璃' },
      { title: '无专辑', artist: '', album: '' },
    ],
    updatedAt: now.toISOString(),
  })
})

test('true empty and partial playlists remain successful without inventing metadata or refetching', async () => {
  const empty = await fetchNeteasePlaylist('123', {
    fetchImpl: async () => response({ trackCount: 0, tracks: [] }),
  })
  assert.equal(empty.title, '')
  assert.equal(empty.author, '')
  assert.equal(empty.description, '')
  assert.deepEqual(empty.songs, [])
  let calls = 0
  const partial = await fetchNeteasePlaylist('123', {
    fetchImpl: async () => {
      assert.equal(
        ++calls,
        1,
        'available tracks must not depend on a second endpoint'
      )
      return response({ ...result, tracks: [first] })
    },
  })
  assert.equal(partial.songCount, 2)
  assert.deepEqual(partial.songs, [
    { title: '玻璃', artist: 'Gareth.T / 另一位歌手', album: '玻璃' },
  ])
})

test('an oversized response exports only the bounded original prefix and retains the declared total', async () => {
  const tracks = Array(5000).fill(first)
  tracks.push({ ...first, name: '超出上限' })
  const data = await fetchNeteasePlaylist('123', {
    fetchImpl: async () => response({ ...result, trackCount: 5001, tracks }),
  })
  assert.equal(data.songCount, 5001)
  assert.equal(data.songs.length, 5000)
  assert.equal(data.songs.at(-1).title, '玻璃')
})

test('business errors and malformed data fail with the adapter error, never upstream content', async () => {
  const bodies = [
    'private upstream dump',
    JSON.stringify({ code: 403, result }),
    JSON.stringify({ result }),
    JSON.stringify({ code: 200, result: null }),
    ...[
      { ...result, trackCount: -1 },
      { ...result, trackCount: 1 },
      { ...result, trackCount: '2' },
      { ...result, tracks: {} },
      { ...result, tracks: [] },
      { ...result, creator: [] },
      { ...result, creator: { nickname: 1 } },
      { ...result, tracks: [{ ...first, name: '' }] },
      { ...result, tracks: [{ ...first, artists: {} }] },
      { ...result, tracks: [{ ...first, artists: [{}] }] },
      { ...result, tracks: [{ ...first, album: [] }] },
    ].map((value) => JSON.stringify({ code: 200, result: value })),
  ]
  for (const body of bodies)
    await assert.rejects(
      fetchNeteasePlaylist('123', {
        fetchImpl: async () => new Response(body),
      }),
      { message: 'Netease playlist: upstream_unavailable' }
    )
})

test('invalid ids never fetch, and transport failures expose no upstream details', async () => {
  await assert.rejects(
    fetchNeteasePlaylist('https://example.com', {
      fetchImpl: async () => assert.fail('must not fetch arbitrary input'),
    }),
    /invalid_source_id/
  )
  for (const fetchImpl of [
    async () => {
      throw new Error('private upstream dump')
    },
    async () => new Response('private upstream dump', { status: 503 }),
  ])
    await assert.rejects(fetchNeteasePlaylist('123', { fetchImpl }), {
      message: 'Netease playlist: upstream_unavailable',
    })
})

test('the single request shares a 15-second budget including its body', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let signal
  let reading
  const bodyStarted = new Promise((resolve) => {
    reading = resolve
  })
  const request = fetchNeteasePlaylist('123', {
    fetchImpl: async (_url, options) => {
      signal = options.signal
      return {
        ok: true,
        text: () =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => reject(new Error('timeout')),
              { once: true }
            )
            reading()
          }),
      }
    },
  })
  await bodyStarted
  t.mock.timers.tick(15_000)
  assert.equal(signal.aborted, true)
  await assert.rejects(request, /upstream_unavailable/)
})
