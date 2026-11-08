import assert from 'node:assert/strict'
import test from 'node:test'
import { handleListening } from '../api/lastfm.js'
import { parseListeningPayload } from '../src/utils/recent-listening.js'

const now = new Date('2026-10-15T08:00:00Z')
const cover = 'https://lastfm-img.freetls.fastly.net/i/u/300x300/album.jpg'
const endpoint = 'https://blog.example/api/lastfm'

/** 最小可用的 Last.fm 上游：每个时段同一张专辑。 */
const upstream = async (request) => {
  const method = request.searchParams.get('method')
  const bodies = {
    'user.getInfo': { user: { playcount: '219' } },
    'user.getTopAlbums': {
      topalbums: {
        'album': [
          {
            name: '玻璃',
            artist: { name: 'Gareth.T' },
            playcount: '7',
            image: [{ '#text': cover }],
          },
        ],
        '@attr': { total: '3' },
      },
    },
  }
  return new Response(JSON.stringify(bodies[method]))
}

const call = ({ url = endpoint, init, ...options } = {}) =>
  handleListening(new Request(url, init), {
    apiKey: 'test-only-key',
    now,
    fetchImpl: upstream,
    findCover: async () => assert.fail('artwork is already available'),
    ...options,
  })

test('a plain GET answers with the snapshot and the CDN cache window', async () => {
  const response = await call()
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /^application\/json/)
  const cache = response.headers.get('cache-control')
  assert.match(cache, /max-age=0/)
  assert.match(cache, /s-maxage=3600/)
  assert.match(cache, /stale-while-revalidate=300/)
  assert.match(cache, /stale-if-error=86400/)
  const payload = await response.json()
  assert.equal(payload.totalScrobbles, 219)
  assert.equal(payload.periods.length, 4)
  assert.equal(payload.periods[0].albums[0].cover, cover)
  assert.ok(
    parseListeningPayload(payload),
    'the page validator must accept the endpoint payload'
  )
})

test('missing configuration and upstream failures are never cached', async () => {
  const missingKey = await call({
    apiKey: undefined,
    fetchImpl: async () => assert.fail('must not reach Last.fm without a key'),
  })
  assert.equal(missingKey.status, 503)
  assert.equal(missingKey.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await missingKey.json(), { error: 'missing_api_key' })

  const failed = await call({
    fetchImpl: async () => new Response('{}', { status: 503 }),
  })
  assert.equal(failed.status, 502)
  assert.equal(failed.headers.get('cache-control'), 'no-store')
  assert.ok(!JSON.stringify(await failed.json()).includes('test-only-key'))
})

test('only the plain address and GET are accepted, so one URL maps to one cache entry', async () => {
  const query = await call({
    url: `${endpoint}?v=2`,
    fetchImpl: async () => assert.fail('query strings must not reach Last.fm'),
  })
  assert.equal(query.status, 400)
  assert.equal(query.headers.get('cache-control'), 'no-store')

  const posted = await call({ init: { method: 'POST' } })
  assert.equal(posted.status, 405)
  assert.equal(posted.headers.get('allow'), 'GET')
  assert.equal(posted.headers.get('cache-control'), 'no-store')
})
