import assert from 'node:assert/strict'
import test from 'node:test'
import { createNeteaseCoverFinder } from '../src/utils/netease-cover.mjs'

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
  assert.deepEqual(
    await find({ kind: 'song', name: 'Deja Vu', artist: 'HAEWON (해원)' }),
    {
      cover: 'https://p1.music.126.net/abc==/1.jpg?param=300y300',
      coverLarge: 'https://p1.music.126.net/abc==/1.jpg?param=600y600',
    }
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
  assert.equal(
    found.cover,
    'https://p1.music.126.net/abc==/1.jpg?param=300y300'
  )
  assert.equal(requests[0].type, '10')
})

test('answers are cached for half an hour, concurrent lookups share one search', async () => {
  let clock = 0
  const { fetchImpl, requests } = upstream(() => ok({ songs: [] }))
  const find = createNeteaseCoverFinder({ fetchImpl, now: () => clock })
  const query = { kind: 'song', name: 'Song', artist: 'Artist' }
  assert.deepEqual(await Promise.all([find(query), find(query)]), [null, null])
  clock += 30 * 60_000 - 1
  await find({ kind: 'song', name: ' song ', artist: 'ARTIST' })
  assert.equal(
    requests.length,
    1,
    'a confirmed miss is reused within the window'
  )
  clock += 1
  await find(query)
  assert.equal(requests.length, 2, 'the entry expires after thirty minutes')
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
