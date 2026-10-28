import assert from 'node:assert/strict'
import test from 'node:test'
import fixture from './fixtures/qq-playlist.json' with { type: 'json' }
import {
  fetchQqPlaylist,
  normalizeQqPayload,
  parseQqResponse,
} from '../src/utils/qq-playlist.mjs'

const item = fixture.cdlist[0]

test('QQ normalization prefers titles, falls back to names and joins all singers', () => {
  const data = normalizeQqPayload(item)
  assert.equal(data.title, '夜间随听')
  assert.equal(data.author, '测试作者')
  assert.equal(data.description, '安静的夜晚。')
  assert.equal(data.songCount, 2)
  assert.deepEqual(data.songs, [
    { title: '玻璃', artist: 'Gareth.T / 另一位歌手', album: '玻璃' },
    { title: 'Monday', artist: '窦靖童', album: '春游' },
  ])
  assert.ok(!('logo' in data))
})

test('JSONP is parsed without execution; plain JSON and songList are supported', () => {
  const json = JSON.stringify(fixture)
  assert.deepEqual(
    parseQqResponse(` \njsonCallback(${json});\n`),
    normalizeQqPayload(item)
  )
  assert.deepEqual(parseQqResponse(json), normalizeQqPayload(item))
  const { songlist, ...rest } = item
  assert.deepEqual(
    normalizeQqPayload({ ...rest, songList: songlist }),
    normalizeQqPayload(item)
  )
  for (const body of [
    'jsonCallback({bad json})',
    `otherCallback(${json})`,
    `jsonCallback(${json});throw new Error('must never execute')`,
    JSON.stringify({ ...fixture, code: 1 }),
    '{"code":0,"cdlist":[]}',
  ])
    assert.throws(() => parseQqResponse(body), /invalid_payload/)
})

test('empty playlists and missing optional metadata are distinct from invalid data', () => {
  assert.deepEqual(normalizeQqPayload({ songnum: 0, songlist: [] }), {
    title: '',
    author: '',
    description: '',
    songCount: 0,
    songs: [],
  })
  assert.deepEqual(
    normalizeQqPayload({
      songnum: 1,
      songlist: [{ title: '无专辑歌曲', singer: [], album: null }],
    }).songs,
    [{ title: '无专辑歌曲', artist: '', album: '' }]
  )
  for (const value of [
    null,
    [],
    {},
    { ...item, songlist: {} },
    { ...item, songnum: -1 },
    { ...item, songnum: 0 },
    { ...item, songnum: '2' },
    { ...item, songlist: [] },
    { ...item, nickname: {} },
    { ...item, songnum: 1, songlist: [{ title: '', singer: [] }] },
    { ...item, songnum: 1, songlist: [{ title: '歌', singer: [{}] }] },
    { ...item, songnum: 1, songlist: [{ title: '歌', singer: [], album: [] }] },
  ])
    assert.throws(() => normalizeQqPayload(value), /invalid_payload/)
})

test('fetch uses the QQ endpoint and the fixed Referer', async () => {
  const data = await fetchQqPlaylist('12345', {
    fetchImpl: async (url, options) => {
      assert.equal(url.origin, 'https://c.y.qq.com')
      assert.equal(url.searchParams.get('disstid'), '12345')
      assert.equal(url.searchParams.get('onlysong'), '0')
      assert.equal(url.searchParams.get('new_format'), '1')
      assert.equal(options.headers.referer, 'https://y.qq.com/')
      assert.ok(options.signal instanceof AbortSignal)
      return new Response(`jsonCallback(${JSON.stringify(fixture)})`)
    },
  })
  assert.deepEqual(data.songs, normalizeQqPayload(item).songs)
})

test('network, HTTP and malformed payload errors never expose upstream text', async () => {
  for (const fetchImpl of [
    async () => {
      throw new Error('private upstream dump')
    },
    async () => new Response('private upstream dump', { status: 503 }),
    async () => new Response('private upstream dump'),
  ])
    await assert.rejects(fetchQqPlaylist('123', { fetchImpl }), {
      message: 'QQ playlist: upstream_unavailable',
    })
  await assert.rejects(
    fetchQqPlaylist('https://example.com'),
    /invalid_source_id/
  )
})

test('the upstream request is aborted after 15 seconds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let signal
  const request = fetchQqPlaylist('123', {
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
