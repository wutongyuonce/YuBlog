/**
 * 停靠点之间的路线：按交通方式请求公共 Valhalla，解码、抽稀、取整；
 * 失败或没有结果时降级为直线，不让整次导入失败。只在导入时运行。
 */

const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route'
const COSTING = { drive: 'auto', walk: 'pedestrian' }
const TIMEOUT_MS = 15_000
const TOLERANCE_METERS = 5
const EARTH_RADIUS = 6_371_008.8

const round = (value) => Math.round(value * 1e5) / 1e5

/**
 * 两点大圆距离（米）。
 * @param {[number, number]} a
 * @param {[number, number]} b
 */
export function haversine([lng1, lat1], [lng2, lat2]) {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * 解码 Valhalla 的 polyline6，返回 `[经度, 纬度]`。
 * @param {string} encoded
 * @param {number} [precision]
 */
export function decodePolyline(encoded, precision = 6) {
  const factor = 10 ** precision
  const points = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0
      let shift = 0
      let byte
      do {
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20 && index < encoded.length)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (axis === 0) lat += delta
      else lng += delta
    }
    points.push([lng / factor, lat / factor])
  }
  return points
}

/** 点到线段的距离（米），在局部等距投影里计算。 */
function segmentDistance(point, start, end) {
  const k = Math.cos((point[1] * Math.PI) / 180)
  const toXY = ([lng, lat]) => [lng * k, lat]
  const [px, py] = toXY(point)
  const [ax, ay] = toXY(start)
  const [bx, by] = toXY(end)
  const dx = bx - ax
  const dy = by - ay
  const t =
    dx === 0 && dy === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))
        )
  const degrees = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
  return (degrees * Math.PI * EARTH_RADIUS) / 180
}

/**
 * Douglas–Peucker 抽稀后取 5 位小数，并去掉取整后重复的相邻点。
 * @param {[number, number][]} path
 * @param {number} [tolerance] 米
 */
export function simplifyPath(path, tolerance = TOLERANCE_METERS) {
  if (path.length <= 2)
    return path.map(([lng, lat]) => [round(lng), round(lat)])
  const keep = new Uint8Array(path.length)
  keep[0] = 1
  keep[path.length - 1] = 1
  const stack = [[0, path.length - 1]]
  while (stack.length > 0) {
    const [first, last] = stack.pop()
    let farthest = -1
    let max = tolerance
    for (let i = first + 1; i < last; i++) {
      const distance = segmentDistance(path[i], path[first], path[last])
      if (distance > max) {
        max = distance
        farthest = i
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1
      stack.push([first, farthest], [farthest, last])
    }
  }
  const rounded = []
  for (let i = 0; i < path.length; i++) {
    if (!keep[i]) continue
    const point = [round(path[i][0]), round(path[i][1])]
    const previous = rounded.at(-1)
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1])
      rounded.push(point)
  }
  if (rounded.length === 1) rounded.push([...rounded[0]])
  return rounded
}

function straight(from, to) {
  return {
    mode: 'straight',
    distance: Math.round(haversine(from, to)),
    path: simplifyPath([from, to]),
  }
}

/**
 * 一段路线。`warning` 只在降级为直线时出现。
 * @param {{ from: [number, number], to: [number, number], mode: string }} leg
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 */
export async function requestRoute(
  { from, to, mode },
  { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}
) {
  const costing = COSTING[mode]
  if (!costing) return { route: straight(from, to) }
  try {
    const response = await fetchImpl(VALHALLA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations: [from, to].map(([lon, lat]) => ({ lon, lat })),
        costing,
        units: 'kilometers',
        directions_type: 'none',
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const trip = (await response.json())?.trip
    const shape = trip?.legs?.[0]?.shape
    const length = trip?.summary?.length
    const time = trip?.summary?.time
    if (typeof shape !== 'string' || !Number.isFinite(length))
      throw new Error('没有可用路线')
    // 路网吸附后的线头接回停靠点，地图上线和点相连。
    const path = simplifyPath([from, ...decodePolyline(shape), to])
    return {
      route: {
        mode,
        distance: Math.round(length * 1000),
        ...(Number.isFinite(time) && { duration: Math.round(time) }),
        path,
      },
    }
  } catch (error) {
    return {
      route: straight(from, to),
      warning: error instanceof Error ? error.message : String(error),
    }
  }
}
