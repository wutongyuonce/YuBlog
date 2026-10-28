import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fetchNeteasePlaylist,
  normalizeNeteaseTrack,
  parseNeteaseDetail,
  parseNeteaseTracks,
} from '../src/utils/netease-playlist.mjs'

const detail = {
  result: {
    name: '夜间随听',
    description: '安静的夜晚。',
    creator: { nickname: '测试作者' },
    trackCount: 2,
    trackIds: [{ id: 11 }, { id: 22 }],
    tracks: [
      {
        name: '玻璃',
        artists: [{ name: 'Gareth.T' }, { name: '另一位歌手' }],
        album: { name: '玻璃' },
      },
      {
        name: 'Monday',
        artists: [{ name: '窦靖童' }],
        album: { name: '春游' },
      },
    ],
  },
}

test('normalization accepts both detail and song shapes and keeps missing albums empty', () => {
  assert.deepEqual(
    normalizeNeteaseTrack({
      name: '晴天',
      ar: [{ name: '周杰伦' }],
      al: { name: '叶惠美' },
    }),
    { title: '晴天', artist: '周杰伦', album: '叶惠美' }
  )
  assert.deepEqual(
    normalizeNeteaseTrack({ name: '无专辑', artists: [], album: null }),
    { title: '无专辑', artist: '', album: '' }
  )
  for (const value of [
    null,
    [],
    { name: '' },
    { name: '歌', artists: {} },
    { name: '歌', artists: [{}] },
    { name: '歌', artists: [{ name: 1 }] },
    { name: '歌', artists: [], album: [] },
  ])
    assert.throws(() => normalizeNeteaseTrack(value), /invalid_payload/)
})

test('detail parsing keeps metadata, declared count and track ids', () => {
  const parsed = parseNeteaseDetail(JSON.stringify(detail))
  assert.equal(parsed.title, '夜间随听')
  assert.equal(parsed.author, '测试作者')
  assert.equal(parsed.description, '安静的夜晚。')
  assert.equal(parsed.songCount, 2)
  assert.deepEqual(parsed.trackIds, [11, 22])
  assert.deepEqual(
    parsed.songs.map(({ title }) => title),
    ['玻璃', 'Monday']
  )
  for (const body of [
    'not json',
    JSON.stringify({ code: 404, msg: 'no resource' }),
    JSON.stringify({ result: { ...detail.result, trackCount: -1 } }),
    JSON.stringify({ result: { ...detail.result, trackCount: 1 } }),
    JSON.stringify({ result: { ...detail.result, tracks: {} } }),
    JSON.stringify({ result: { ...detail.result, trackIds: [{}] } }),
    JSON.stringify({ result: { ...detail.result, creator: { nickname: 1 } } }),
  ])
    assert.throws(() => parseNeteaseDetail(body), /invalid_payload/)
})

test('batch parsing keeps upstream order and rejects malformed envelopes', () => {
  assert.deepEqual(
    parseNeteaseTracks(
      JSON.stringify({
        songs: [{ name: '甲', ar: [{ name: 'A' }], al: { name: 'X' } }],
      })
    ),
    [{ title: '甲', artist: 'A', album: 'X' }]
  )
  for (const body of ['', 'not json', JSON.stringify({ songs: {} })])
    assert.throws(() => parseNeteaseTracks(body), /invalid_payload/)
})

test('fetch reads the detail endpoint once for a complete playlist', async () => {
  const now = new Date('2026-10-28T02:00:00Z')
  const calls = []
  const data = await fetchNeteasePlaylist('3778678', {
    now,
    fetchImpl: async (url, options) => {
      calls.push(String(url))
      assert.equal(url.origin, 'https://music.163.com')
      assert.equal(url.pathname, '/api/playlist/detail')
      assert.equal(url.searchParams.get('id'), '3778678')
      assert.equal(url.searchParams.get('s'), '0')
      assert.equal(options.headers.referer, 'https://music.163.com/')
      assert.ok(options.signal instanceof AbortSignal)
      return new Response(JSON.stringify(detail))
    },
  })
  assert.equal(calls.length, 1)
  assert.equal(data.updatedAt, now.toISOString())
  assert.equal(data.songCount, 2)
  assert.deepEqual(
    data.songs.map(({ title }) => title),
    ['玻璃', 'Monday']
  )
})

test('fetch refills a truncated detail by track ids in playlist order', async () => {
  const truncated = {
    result: { ...detail.result, tracks: detail.result.tracks.slice(0, 1) },
  }
  const calls = []
  const data = await fetchNeteasePlaylist('3778678', {
    fetchImpl: async (url) => {
      calls.push(url.pathname)
      if (url.pathname === '/api/playlist/detail')
        return new Response(JSON.stringify(truncated))
      assert.equal(url.pathname, '/api/v3/song/detail')
      assert.deepEqual(JSON.parse(url.searchParams.get('c')), [
        { id: 11 },
        { id: 22 },
      ])
      return new Response(
        JSON.stringify({
          songs: [
            { name: '玻璃', ar: [{ name: 'Gareth.T' }], al: { name: '玻璃' } },
            { name: 'Monday', ar: [{ name: '窦靖童' }], al: { name: '春游' } },
          ],
        })
      )
    },
  })
  assert.deepEqual(calls, ['/api/playlist/detail', '/api/v3/song/detail'])
  assert.equal(data.songs.length, 2)
})

test('network, HTTP and malformed payload errors never expose upstream text', async () => {
  for (const fetchImpl of [
    async () => {
      throw new Error('private upstream dump')
    },
    async () => new Response('private upstream dump', { status: 503 }),
    async () => new Response('private upstream dump'),
  ])
    await assert.rejects(fetchNeteasePlaylist('123', { fetchImpl }), {
      message: 'Netease playlist: upstream_unavailable',
    })
  await assert.rejects(
    fetchNeteasePlaylist('https://example.com'),
    /invalid_source_id/
  )
})

test('an empty but non-empty-declared playlist is treated as upstream failure', async () => {
  await assert.rejects(
    fetchNeteasePlaylist('123', {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ result: { ...detail.result, tracks: [] } })
        ),
    }),
    { message: 'Netease playlist: upstream_unavailable' }
  )
})

test('the upstream request is aborted after 15 seconds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let signal
  const request = fetchNeteasePlaylist('123', {
    fetchImpl: (_url, options) =>
      new Promise((_resolve, reject) => {
        signal = options.signal
        signal.addEventListener('abort', () => reject(new Error('timeout')), {
          once: true,
        })
      }),
  })
  assert.equal(signal.aborted, false)
  t.mock.timers.tick(15_000)
  assert.equal(signal.aborted, true)
  await assert.rejects(request, /upstream_unavailable/)
})
