import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createNeteaseCoverFinder,
  neteaseSized,
} from '../src/utils/netease-cover.mjs'

const pic = 'http://p1.music.126.net/abc==/1.jpg'
const song = (name, artists, picUrl = pic) => ({
  name,
  ar: artists.map((artist) =>
    typeof artist === 'string' ? { name: artist } : artist
  ),
  al: { picUrl },
})

/** 假上游：记录每次搜索，按 `respond` 返回响应。 */
const upstream = (respond) => {
  const requests = []
  const fetchImpl = async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal)
    assert.equal(options.headers.referer, 'https://music.163.com/')
    requests.push(Object.fromEntries(url.searchParams))
    return respond(url)
  }
  return { fetchImpl, requests }
}
const ok = (result) =>
  new Response(JSON.stringify({ code: 200, result }), { status: 200 })

test('only a candidate whose name and artist both match supplies the cover', async () => {
  const { fetchImpl, requests } = upstream(() =>
    ok({
      songs: [
        song(
          '널 사랑하지 않아 (Live)',
          ['Urban Zakapa'],
          'http://p2.music.126.net/wrong.jpg'
        ),
        song('Deja Vu (Live)', [{ name: 'Someone', alia: ['HAEWON'] }]),
      ],
    })
  )
  const find = createNeteaseCoverFinder({ fetchImpl })
  const found = await find({
    kind: 'song',
    name: 'Deja Vu',
    artist: 'HAEWON (해원)',
  })
  assert.equal(found, 'https://p1.music.126.net/abc==/1.jpg')
  assert.equal(
    neteaseSized(found, 300),
    'https://p1.music.126.net/abc==/1.jpg?param=300y300'
  )
  assert.deepEqual(requests, [
    { s: 'Deja Vu HAEWON (해원)', type: '1', limit: '5' },
  ])
  assert.equal(
    await find({
      kind: 'song',
      name: '널 사랑하지 않아',
      artist: '(여자)아이들',
    }),
    null,
    'a same-named song by another artist must not lend its cover'
  )
})

test('notes are left out of the query and joint artists match one by one', async () => {
  const { fetchImpl, requests } = upstream(() =>
    ok({
      albums: [
        { name: '0.5x', artist: { name: 'BikaBreezy' }, picUrl: pic },
        { name: '0.5x', artist: { name: 'H.E.R.' }, picUrl: pic },
        { name: 'LA FAMA', artists: [{ name: 'ROSALÍA' }], picUrl: pic },
      ],
    })
  )
  const find = createNeteaseCoverFinder({ fetchImpl })
  assert.ok(
    await find({
      kind: 'album',
      name: '0.5x (零点五倍速)',
      artist: 'BikaBreezy',
    })
  )
  assert.equal(requests[0].s, '0.5x BikaBreezy')
  assert.ok(
    await find({
      kind: 'album',
      name: 'LA FAMA',
      artist: 'Rosalía, The Weeknd',
    }),
    'one artist of a joint credit is enough'
  )
  // feat./ft. 只在独立成词时拆分：「Feather」不能被拆出一个「her」去匹配别人。
  assert.equal(
    await find({ kind: 'album', name: '0.5x', artist: 'Feather' }),
    null
  )
})

test('traditional and simplified names compare as the same text', async () => {
  const { fetchImpl } = upstream(() =>
    ok({
      albums: [{ name: '我要快乐', artist: { name: '张惠妹' }, picUrl: pic }],
    })
  )
  const find = createNeteaseCoverFinder({ fetchImpl })
  assert.ok(
    await find({
      kind: 'album',
      name: '我要快樂 (Deluxe Version)',
      artist: '張惠妹',
    })
  )
})

test('a renamed artist is accepted only through an exact title and the top artist hit', async () => {
  const album = (name, id, picUrl) => ({
    name,
    artist: { name: '孙盛希', id },
    picUrl,
  })
  const answer = (topId) => (url) => {
    const { s, type } = Object.fromEntries(url.searchParams)
    if (type === '100') return ok({ artists: [{ name: '孙盛希', id: topId }] })
    // 带歌手的第一轮搜不到；只按名称的第二轮才找到。
    return ok({
      albums: s.includes('Shi Shi')
        ? []
        : [
            // 异常记录（没有名称）不能让整次查找失败。
            album(null, 954154, pic),
            album(
              '|希。O2 | 初雪限定 (Remix)',
              954154,
              'http://p1.music.126.net/remix.jpg'
            ),
            album('|希。O2 | 初雪限定', 954154, pic),
          ],
    })
  }
  const query = { kind: 'album', name: '|希。O2 | 初雪限定', artist: 'Shi Shi' }
  const hit = upstream(answer(954154))
  assert.equal(
    await createNeteaseCoverFinder({ fetchImpl: hit.fetchImpl })(query),
    'https://p1.music.126.net/abc==/1.jpg',
    'the remix is not the same album'
  )
  assert.deepEqual(
    hit.requests.map((r) => [r.type, r.s]),
    [
      ['10', '|希。O2 | 初雪限定 Shi Shi'],
      ['10', '|希。O2 | 初雪限定'],
      ['100', 'Shi Shi'],
    ]
  )
  const other = upstream(answer(1))
  assert.equal(
    await createNeteaseCoverFinder({ fetchImpl: other.fetchImpl })(query),
    null,
    'an unrelated top artist does not vouch for the album'
  )
  // 歌手搜索失败只短暂缓存：一分钟后重新搜，而不是当作确认搜不到。
  let clock = 0
  const failing = upstream((url) =>
    url.searchParams.get('type') === '100'
      ? new Response('{}', { status: 503 })
      : answer(954154)(url)
  )
  const find = createNeteaseCoverFinder({
    fetchImpl: failing.fetchImpl,
    now: () => clock,
  })
  assert.equal(await find(query), null)
  clock += 60_000
  await find(query)
  assert.equal(
    failing.requests.filter((r) => r.type === '100').length,
    2,
    'a failed artist search is retried after a minute'
  )
})

test('a short name inside a much longer one is not a match', async () => {
  const { fetchImpl } = upstream(() =>
    ok({
      albums: [
        { name: 'Live in Texas', artist: { name: 'Linkin Park' }, picUrl: pic },
        { name: '等到十三月', artist: { name: '陈小满阿' }, picUrl: pic },
      ],
    })
  )
  const find = createNeteaseCoverFinder({ fetchImpl })
  // 名称与歌手分别单独不合格，各自都要拒绝。
  assert.equal(
    await find({ kind: 'album', name: 'Live', artist: 'Linkin Park' }),
    null
  )
  assert.equal(
    await find({ kind: 'album', name: 'Live in Texas', artist: 'Lin' }),
    null
  )
  assert.ok(
    await find({ kind: 'album', name: '等到十三月', artist: '陈小满' }),
    'a near-identical artist name still matches'
  )
})

test('album search tolerates edition notes but rejects foreign image hosts', async () => {
  const { fetchImpl, requests } = upstream(() =>
    ok({
      albums: [
        {
          name: 'Album',
          artist: { name: 'Artist' },
          picUrl: 'https://evil.example/a.jpg',
        },
        { name: 'Album', artists: [{ name: 'Artist' }], picUrl: pic },
      ],
    })
  )
  const find = createNeteaseCoverFinder({ fetchImpl })
  const found = await find({
    kind: 'album',
    name: 'Album (10 Year Anniversary Edition) [Explicit]',
    artist: 'Artist',
  })
  assert.equal(found, 'https://p1.music.126.net/abc==/1.jpg')
  assert.equal(requests[0].type, '10')
})

test('answers are cached for half an hour, concurrent lookups share one search', async () => {
  let clock = 0
  const { fetchImpl, requests } = upstream(() => ok({ songs: [] }))
  const find = createNeteaseCoverFinder({ fetchImpl, now: () => clock })
  const query = { kind: 'song', name: 'Song', artist: 'Artist' }
  assert.deepEqual(await Promise.all([find(query), find(query)]), [null, null])
  // 一次确认搜不到：先带歌手搜，再只按名称搜。
  assert.deepEqual(
    requests.map((r) => r.s),
    ['Song Artist', 'Song']
  )
  clock += 30 * 60_000 - 1
  await find({ kind: 'song', name: ' song ', artist: 'ARTIST' })
  assert.equal(
    requests.length,
    2,
    'a confirmed miss is reused within the window'
  )
  clock += 1
  await find(query)
  assert.equal(requests.length, 4, 'the entry expires after thirty minutes')
})

test('failures resolve to null and are retried after a minute', async () => {
  for (const respond of [
    () => {
      throw new Error('network down')
    },
    () => new Response('{}', { status: 503 }),
    () => new Response(JSON.stringify({ code: -460 })),
    () => new Response('not json'),
  ]) {
    let clock = 0
    const { fetchImpl, requests } = upstream(respond)
    const find = createNeteaseCoverFinder({ fetchImpl, now: () => clock })
    const query = { kind: 'album', name: 'Album', artist: 'Artist' }
    assert.equal(await find(query), null)
    clock += 60_000 - 1
    assert.equal(await find(query), null)
    assert.equal(
      requests.length,
      1,
      'an outage is not retried on every request'
    )
    clock += 1
    await find(query)
    assert.equal(
      requests.length,
      2,
      'a failed search is retried after a minute'
    )
  }
  const { fetchImpl, requests } = upstream(() => ok({}))
  const find = createNeteaseCoverFinder({ fetchImpl })
  assert.equal(await find({ kind: 'song', name: '...', artist: 'A' }), null)
  assert.equal(requests.length, 0, 'names without searchable text are skipped')
})
