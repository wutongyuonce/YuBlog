/**
 * 停靠点之间的路线：来源已给出路线（圆周）时直接抽稀使用；路网方式向公共
 * Valhalla 请求；班次和公共交通画两点直线。失败时保留交通方式、按直线计里程，
 * 不让整次导入失败。只在导入时运行。
 */

import { EARTH_RADIUS, haversine } from './geo.mjs'
import { SCHEDULED_MODES } from './trips.js'

const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route'
const COSTING = {
  drive: 'auto',
  taxi: 'auto',
  walk: 'pedestrian',
  bike: 'bicycle',
}
const TIMEOUT_MS = 15_000
const TOLERANCE_METERS = 5

const round = (value) => Math.round(value * 1e5) / 1e5

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
        if (index >= encoded.length) throw new Error('路线编码不完整')
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
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

/**
 * 两点直线：班次本来就画直线；其余方式是没有路线时的降级，标上 `straight`。
 * 只有已知时长才带。
 */
function straight(from, to, mode, duration) {
  return {
    mode,
    distance: Math.round(haversine(from, to)),
    ...(duration !== undefined && { duration }),
    ...(!SCHEDULED_MODES.has(mode) && { straight: true }),
    path: simplifyPath([from, to]),
  }
}

/**
 * 一段路线。`warning` 只在路网方式降级为直线时出现。
 * - 来源给了 `hint`（路径、距离、时长、公交明细）时直接使用，线头接回停靠点。
 * - 开车、打车、步行、骑行向 Valhalla 请求。
 * - 飞机、火车、船和没有路线的公共交通画两点直线。
 * - 两站在同一点时是一段零里程的路，不请求。
 * @param {{ from: [number, number], to: [number, number], mode: string, duration?: number, hint?: { distance: number, duration?: number, path: [number, number][], transit?: object } }} leg
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 */
export async function requestRoute(
  { from, to, mode, duration, hint },
  { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}
) {
  if (from[0] === to[0] && from[1] === to[1])
    return { route: { mode, distance: 0, path: simplifyPath([from, to]) } }
  if (hint)
    return {
      route: {
        mode,
        distance: hint.distance,
        ...((duration ?? hint.duration) !== undefined && {
          duration: duration ?? hint.duration,
        }),
        path: simplifyPath([from, ...hint.path, to]),
        ...(hint.transit && { transit: hint.transit }),
      },
    }
  const costing = COSTING[mode]
  if (!costing) return { route: straight(from, to, mode, duration) }
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
      route: straight(from, to, mode, duration),
      warning: error instanceof Error ? error.message : String(error),
    }
  }
}
