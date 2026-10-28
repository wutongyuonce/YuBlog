import assert from 'node:assert/strict'
import test from 'node:test'

import { handleScreenTime } from '../api/screen-time.js'
import { screenTimePeriods } from '../src/utils/screen-time.js'
import {
  readScreenTime,
  writeScreenTime,
} from '../src/utils/screen-time-store.mjs'

const CACHE =
  'public, max-age=0, s-maxage=600, stale-while-revalidate=60, stale-if-error=86400'
const UPDATED = '2026-10-27T12:00:00.000Z'

const snapshot = () => ({
  timeZone: 'Asia/Shanghai',
  updatedAt: UPDATED,
  days: screenTimePeriods(new Date(UPDATED)).map(({ date }) => ({
    date,
    seconds: 600,
    apps: [{ name: 'Safari', seconds: 600 }],
  })),
})

const get = (path = '/api/screen-time', method = 'GET') =>
  new Request(`https://wutongyu.site${path}`, { method })

test('only an unparameterised GET is served', async () => {
  const post = await handleScreenTime(get('/api/screen-time', 'POST'), {
    read: async () => snapshot(),
  })
  assert.equal(post.status, 405)
  assert.equal(post.headers.get('allow'), 'GET')
  assert.equal(post.headers.get('cache-control'), 'no-store')

  const query = await handleScreenTime(get('/api/screen-time?user=me'), {
    read: async () => snapshot(),
  })
  assert.equal(query.status, 400)
  assert.deepEqual(await query.json(), { error: 'unexpected_query' })
  assert.equal(query.headers.get('cache-control'), 'no-store')
})

test('a store that is not connected is a configuration error, not a cacheable answer', async () => {
  const previous = process.env.BLOB_STORE_ID
  delete process.env.BLOB_STORE_ID
  try {
    const response = await handleScreenTime(get())
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'missing_blob_store' })
    assert.equal(response.headers.get('cache-control'), 'no-store')
  } finally {
    if (previous !== undefined) process.env.BLOB_STORE_ID = previous
  }
})

test('a malformed snapshot is rejected instead of partially rendered', async () => {
  const broken = snapshot()
  broken.days[0].date = '2026-10-01'
  const response = await handleScreenTime(get(), { read: async () => broken })
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: 'snapshot_unavailable' })
  assert.equal(response.headers.get('cache-control'), 'no-store')

  const failed = await handleScreenTime(get(), {
    read: async () => {
      throw new Error('Screen time: blob HTTP 500')
    },
  })
  assert.equal(failed.status, 502)
  assert.equal(failed.headers.get('cache-control'), 'no-store')
})

test('the published snapshot is served with the shared cache policy', async () => {
  const response = await handleScreenTime(get(), {
    read: async () => snapshot(),
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), CACHE)
  assert.equal(
    response.headers.get('content-type'),
    'application/json; charset=utf-8'
  )
  assert.deepEqual(await response.json(), snapshot())
})

test('the store reads the public object without a metadata lookup', async () => {
  const urls = []
  const fetchImpl = async (url) => {
    urls.push(url)
    return new Response(JSON.stringify(snapshot()))
  }
  assert.deepEqual(
    await readScreenTime({ storeId: 'store_xDHKr1R8vOnmri5O', fetchImpl }),
    snapshot()
  )
  // 前缀可有可无，与 @vercel/blob 自己对存储 ID 的处理一致。
  await readScreenTime({ storeId: 'xDHKr1R8vOnmri5O', fetchImpl })
  assert.deepEqual(urls, [
    'https://xdhkr1r8vonmri5o.public.blob.vercel-storage.com/screen-time.json',
    'https://xdhkr1r8vonmri5o.public.blob.vercel-storage.com/screen-time.json',
  ])
  await assert.rejects(
    readScreenTime({ storeId: 'store_x/y', fetchImpl }),
    /BLOB_STORE_ID/
  )
  await assert.rejects(
    readScreenTime({
      storeId: 'store_xDHKr1R8vOnmri5O',
      fetchImpl: async () => new Response('missing', { status: 404 }),
    }),
    /blob HTTP 404/
  )
})

test('the store overwrites a single public object with a short cache', async () => {
  const writes = []
  const store = {
    put: async (pathname, body, options) => {
      writes.push({ pathname, body, options })
      return { url: 'https://blob.test/screen-time.json' }
    },
  }
  const url = await writeScreenTime(snapshot(), { token: 't', client: store })
  assert.equal(url, 'https://blob.test/screen-time.json')
  assert.equal(writes[0].pathname, 'screen-time.json')
  assert.deepEqual(JSON.parse(writes[0].body), snapshot())
  assert.deepEqual(writes[0].options, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60,
    token: 't',
  })
  await assert.rejects(
    writeScreenTime(snapshot(), { token: '', client: store }),
    /BLOB_READ_WRITE_TOKEN/
  )
})
