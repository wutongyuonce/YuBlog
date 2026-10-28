import assert from 'node:assert/strict'
import test from 'node:test'
import { handlePlaylists } from '../api/playlists.js'
import config from '../src/data/playlists.json' with { type: 'json' }
import fixture from './fixtures/qq-playlist.json' with { type: 'json' }
import { parsePlaylistsPayload } from '../src/utils/playlists-ui.js'

const now = new Date('2026-10-28T02:00:00Z')
const endpoint = 'https://blog.example/api/playlists'
const call = ({ url = endpoint, init, ...options } = {}) =>
  handlePlaylists(new Request(url, init), {
    now,
    fetchImpl: async (url) => {
      assert.ok(
        config.some(
          (entry) => entry.sourceId === url.searchParams.get('disstid')
        )
      )
      return new Response(`jsonCallback(${JSON.stringify(fixture)})`)
    },
    ...options,
  })

test('a plain GET returns all fixed playlists with the listening CDN window', async () => {
  const response = await call()
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /^application\/json/)
  assert.equal(
    response.headers.get('cache-control'),
    'public, max-age=0, s-maxage=1800, stale-while-revalidate=300, stale-if-error=86400'
  )
  const data = await response.json()
  assert.equal(data.updatedAt, now.toISOString())
  assert.deepEqual(
    data.playlists.map((entry) => entry.id),
    config.map((entry) => entry.id)
  )
  for (const [index, playlist] of data.playlists.entries()) {
    assert.equal(
      playlist.title,
      fixture.cdlist[0].dissname,
      'API title overrides fallback'
    )
    assert.equal(
      playlist.cover,
      config[index].cover,
      'remote logo is never displayed'
    )
    assert.equal(playlist.url, config[index].url)
    assert.equal(playlist.songs.length, 2)
    assert.equal(playlist.songCount, 2)
  }
  assert.ok(
    parsePlaylistsPayload(data, config),
    'the client accepts the endpoint snapshot'
  )
})

test('config title is the fallback and a real empty playlist remains a success', async () => {
  const response = await call({
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          code: 0,
          cdlist: [{ songnum: 0, songlist: [] }],
        })
      ),
  })
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.playlists[0].title, config[0].title || config[0].id)
  assert.deepEqual(data.playlists[0].songs, [])
  assert.ok(parsePlaylistsPayload(data, config))
})

test('upstream HTTP, network and shape failures return a sanitized uncached 502', async () => {
  for (const fetchImpl of [
    async () => new Response('upstream dump', { status: 503 }),
    async () => {
      throw new Error('upstream dump')
    },
    async () => new Response('{"code":0,"cdlist":[{}]}'),
  ]) {
    const response = await call({ fetchImpl })
    assert.equal(response.status, 502)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { error: 'upstream_unavailable' })
  }
})

test('queries and non-GET methods never reach the upstream service', async () => {
  const fetchImpl = async () => assert.fail('must not fetch arbitrary input')
  for (const query of ['?id=123', '?url=https://example.com', '?v=2']) {
    const response = await call({ url: `${endpoint}${query}`, fetchImpl })
    assert.equal(response.status, 400)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { error: 'unexpected_query' })
  }
  for (const method of ['POST', 'HEAD', 'OPTIONS', 'DELETE']) {
    const response = await call({ init: { method }, fetchImpl })
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'GET')
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
})
