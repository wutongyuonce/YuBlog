import assert from 'node:assert/strict'
import test from 'node:test'

import { haversine } from '../src/utils/geo.mjs'
import {
  decodePolyline,
  requestRoute,
  simplifyPath,
} from '../src/utils/trip-routes.mjs'

const from = [106.5, 29.5]
const to = [106.52, 29.51]

function encode(points, precision = 6) {
  const factor = 10 ** precision
  let lastLat = 0
  let lastLng = 0
  let out = ''
  const chunk = (value) => {
    let v = value < 0 ? ~(value << 1) : value << 1
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
      v >>= 5
    }
    out += String.fromCharCode(v + 63)
  }
  for (const [lng, lat] of points) {
    const latE = Math.round(lat * factor)
    const lngE = Math.round(lng * factor)
    chunk(latE - lastLat)
    chunk(lngE - lastLng)
    lastLat = latE
    lastLng = lngE
  }
  return out
}

test('polyline6 decodes to [lng, lat]', () => {
  const points = [
    [106.5, 29.5],
    [106.512345, 29.498765],
  ]
  assert.deepEqual(decodePolyline(encode(points)), points)
})

test('simplification drops near-collinear points and rounds to 5 decimals', () => {
  const path = [
    [106.5, 29.5],
    [106.5005, 29.500001],
    [106.501, 29.5],
    [106.501, 29.502],
  ]
  assert.deepEqual(simplifyPath(path), [
    [106.5, 29.5],
    [106.501, 29.5],
    [106.501, 29.502],
  ])
  assert.equal(simplifyPath([from, from]).length, 2)
})

test('routed legs keep the service distance and join the stops', async () => {
  const fetchImpl = async () =>
    Response.json({
      trip: {
        summary: { length: 2.5, time: 1800 },
        legs: [
          {
            shape: encode([
              [106.501, 29.501],
              [106.519, 29.509],
            ]),
          },
        ],
      },
    })
  const { route, warning } = await requestRoute(
    { from, to, mode: 'walk' },
    { fetchImpl }
  )
  assert.equal(warning, undefined)
  assert.equal(route.mode, 'walk')
  assert.equal(route.distance, 2500)
  assert.equal(route.duration, 1800)
  assert.deepEqual(route.path[0], from)
  assert.deepEqual(route.path.at(-1), to)
})

test('a truncated route shape falls back instead of inventing a point', async () => {
  const shape = encode([
    [106.501, 29.501],
    [106.519, 29.509],
  ])
  const { route, warning } = await requestRoute(
    { from, to, mode: 'drive' },
    {
      fetchImpl: async () =>
        Response.json({
          trip: {
            summary: { length: 2.5 },
            legs: [{ shape: shape.slice(0, -1) }],
          },
        }),
    }
  )
  assert.deepEqual([route.mode, route.straight], ['drive', true])
  assert.match(warning, /不完整/)
})

const noFetch = {
  fetchImpl: () => {
    throw new Error('should not be called')
  },
}

test('scheduled legs are plain straight lines; transit without a route is marked', async () => {
  const { route } = await requestRoute(
    { from, to, mode: 'flight', duration: 8700 },
    noFetch
  )
  assert.deepEqual(
    [route.mode, route.duration, route.path.length, route.straight],
    ['flight', 8700, 2, undefined]
  )
  for (const mode of ['train', 'ferry'])
    assert.equal(
      (await requestRoute({ from, to, mode }, noFetch)).route.straight,
      undefined
    )
  const transit = await requestRoute({ from, to, mode: 'transit' }, noFetch)
  assert.deepEqual([transit.route.straight, transit.warning], [true, undefined])
})

test('a route hint from the source is used without asking a service', async () => {
  const transit = { lines: [{ name: '轨道交通9号线' }] }
  const { route } = await requestRoute(
    {
      from,
      to,
      mode: 'transit',
      hint: {
        distance: 7722,
        duration: 2489,
        path: [[106.51, 29.52]],
        transit,
      },
    },
    noFetch
  )
  assert.deepEqual(route, {
    mode: 'transit',
    distance: 7722,
    duration: 2489,
    path: [from, [106.51, 29.52], to],
    transit,
  })
  // 同一点之间是零里程，不请求。
  const still = await requestRoute({ from, to: from, mode: 'walk' }, noFetch)
  assert.equal(still.route.distance, 0)
})

test('road modes ask Valhalla for the matching costing', async () => {
  const asked = []
  for (const mode of ['drive', 'taxi', 'walk', 'bike'])
    await requestRoute(
      { from, to, mode },
      {
        fetchImpl: async (_url, init) => {
          asked.push(JSON.parse(init.body).costing)
          return new Response('busy', { status: 503 })
        },
      }
    )
  assert.deepEqual(asked, ['auto', 'auto', 'pedestrian', 'bicycle'])
})

test('a failed road request falls back to a straight line', async () => {
  const failed = await requestRoute(
    { from, to, mode: 'drive' },
    { fetchImpl: async () => new Response('busy', { status: 503 }) }
  )
  // 降级保留交通方式，只标出没有路线。
  assert.deepEqual([failed.route.mode, failed.route.straight], ['drive', true])
  assert.match(failed.warning, /503/)
  assert.equal(failed.route.distance, Math.round(haversine(from, to)))
  assert.equal(failed.route.duration, undefined)
})
