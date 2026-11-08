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
  const fetchImpl = async (_url, init) => {
    assert.equal(JSON.parse(init.body).costing, 'pedestrian')
    return Response.json({
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
  }
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
  assert.equal(route.mode, 'straight')
  assert.match(warning, /不完整/)
})

test('flights and trains are straight lines that keep their mode and timetable', async () => {
  const { route } = await requestRoute(
    { from, to, mode: 'flight', duration: 8700 },
    {
      fetchImpl: () => {
        throw new Error('should not be called')
      },
    }
  )
  assert.deepEqual(
    [route.mode, route.duration, route.path.length],
    ['flight', 8700, 2]
  )
})

test('failures and unknown modes fall back to a straight line', async () => {
  const failed = await requestRoute(
    { from, to, mode: 'drive' },
    { fetchImpl: async () => new Response('busy', { status: 503 }) }
  )
  assert.equal(failed.route.mode, 'straight')
  assert.match(failed.warning, /503/)
  assert.equal(failed.route.distance, Math.round(haversine(from, to)))
  assert.equal(failed.route.duration, undefined)

  const unknown = await requestRoute(
    { from, to, mode: 'straight' },
    {
      fetchImpl: () => {
        throw new Error('should not be called')
      },
    }
  )
  assert.equal(unknown.route.mode, 'straight')
  assert.equal(unknown.warning, undefined)
})
