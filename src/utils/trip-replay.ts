/**
 * 旅程回放：按一条时间线逐站停留、逐段画线，标记沿线前进、镜头跟随。
 * 减少动态效果时不画动画，只逐站切换。时间线是纯数据（`buildTimeline`），
 * 地图图层与帧循环在 `createReplay`。
 */
import type {
  ExpressionSpecification,
  Marker,
  PaddingOptions,
} from 'maplibre-gl'

import { haversine as distance } from './geo.mjs'
import type { TripGeo, TripMap } from './trip-map'

const DWELL_MS = 2200
const REDUCED_DWELL_MS = 3000
const MIN_TRAVEL_MS = 1200
const MAX_TRAVEL_MS = 4500
const MS_PER_KM = 450
const LINE_SOURCE = 'trips-replay'
const LINE_LAYER = 'trips-replay'
const PLANNED_LAYER = 'trips-replay-planned'

type Step =
  | {
      kind: 'dwell'
      stop: number
      start: number
      duration: number
      /** 该站的沿线距离（米）。 */
      at: number
    }
  | {
      kind: 'travel'
      stop: number
      start: number
      duration: number
      from: number
      to: number
    }

/**
 * 全程路径、沿线累计距离与时间线。路段的 `from`／`to` 是沿线距离（米）。
 */
export function buildTimeline(trip: TripGeo, reducedMotion: boolean) {
  const path: [number, number][] = []
  const cumulative: number[] = []
  const legRange = new Map<number, { from: number; to: number }>()
  const stopAt = new Map<number, number>()
  const push = (point: [number, number]) => {
    const last = path.at(-1)
    if (last && last[0] === point[0] && last[1] === point[1]) return
    cumulative.push(last ? cumulative.at(-1)! + distance(last, point) : 0)
    path.push(point)
  }
  for (const stop of trip.stops) {
    const leg = trip.legs.find((item) => item.from === stop.index)
    push(stop.coordinates)
    stopAt.set(stop.index, cumulative.at(-1)!)
    if (!leg) continue
    const from = cumulative.at(-1)!
    for (const point of leg.path) push(point)
    legRange.set(stop.index, { from, to: cumulative.at(-1)! })
  }

  const steps: Step[] = []
  let clock = 0
  for (const stop of trip.stops) {
    const dwell = reducedMotion ? REDUCED_DWELL_MS : DWELL_MS
    steps.push({
      kind: 'dwell',
      stop: stop.index,
      start: clock,
      duration: dwell,
      at: stopAt.get(stop.index)!,
    })
    clock += dwell
    const range = legRange.get(stop.index)
    if (!range || reducedMotion) continue
    const km = (range.to - range.from) / 1000
    const duration = Math.min(
      MAX_TRAVEL_MS,
      Math.max(MIN_TRAVEL_MS, km * MS_PER_KM)
    )
    steps.push({
      kind: 'travel',
      stop: stop.index,
      start: clock,
      duration,
      ...range,
    })
    clock += duration
  }
  return {
    path,
    cumulative,
    steps,
    total: clock,
    length: cumulative.at(-1) ?? 0,
  }
}

/** 沿线距离 `at` 处的坐标。 */
export function pointAlong(
  path: [number, number][],
  cumulative: number[],
  at: number
): [number, number] {
  if (path.length === 1 || at <= 0) return path[0]
  if (at >= cumulative.at(-1)!) return path.at(-1)!
  let low = 0
  let high = cumulative.length - 1
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (cumulative[middle] <= at) low = middle
    else high = middle
  }
  const span = cumulative[high] - cumulative[low] || 1
  const t = (at - cumulative[low]) / span
  return [
    path[low][0] + (path[high][0] - path[low][0]) * t,
    path[low][1] + (path[high][1] - path[low][1]) * t,
  ]
}

export interface ReplayOptions {
  tripMap: TripMap
  trip: TripGeo
  getPadding: () => PaddingOptions
  /** 到达某站（停留开始）。 */
  onStop: (index: number) => void
  onPlayingChange: (playing: boolean) => void
  onEnd: () => void
}

export async function createReplay(options: ReplayOptions) {
  const { tripMap, trip, getPadding } = options
  const { map } = tripMap
  const maplibregl = await import('maplibre-gl')
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  const timeline = buildTimeline(trip, reducedMotion)
  const head = document.createElement('span')
  head.className = 'trips-replay-head'
  head.style.setProperty('--trip-color', trip.color)
  const marker: Marker = new maplibregl.Marker({ element: head }).setLngLat(
    timeline.path[0]
  )

  let elapsed = 0
  let startedAt = 0
  let frame = 0
  let playing = false
  let stepIndex = -1
  let finished = false

  function addLayers() {
    if (map.getSource(LINE_SOURCE)) return
    map.addSource(LINE_SOURCE, {
      type: 'geojson',
      lineMetrics: true,
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: timeline.path },
      },
    })
    map.addLayer({
      id: PLANNED_LAYER,
      type: 'line',
      source: LINE_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': trip.color,
        'line-width': 2,
        'line-opacity': 0.35,
        'line-dasharray': [1, 2],
      },
    })
    map.addLayer({
      id: LINE_LAYER,
      type: 'line',
      source: LINE_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-width': 4,
        'line-gradient': progress(0),
      },
    })
    tripMap.setBaseLayersVisible(false)
  }

  /** 路线进度 `ratio` 之前着色、之后透明。数据只发一次，每帧只改这个表达式。 */
  function progress(ratio: number): ExpressionSpecification {
    return ['step', ['line-progress'], trip.color, ratio, 'rgba(0, 0, 0, 0)']
  }

  function drawn(at: number) {
    if (!map.getLayer(LINE_LAYER) || timeline.length === 0) return
    const ratio = Math.min(1, Math.max(0, at / timeline.length))
    map.setPaintProperty(LINE_LAYER, 'line-gradient', progress(ratio))
  }

  function zoomFor(step: Extract<Step, { kind: 'travel' }>) {
    const from = timeline.cumulative.findIndex((value) => value >= step.from)
    const to = timeline.cumulative.findIndex((value) => value >= step.to)
    const points = timeline.path.slice(from, to + 1)
    const lngs = points.map(([lng]) => lng)
    const lats = points.map(([, lat]) => lat)
    const camera = map.cameraForBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: getPadding() }
    )
    return Math.min(15, camera?.zoom ?? 14)
  }

  let travelZoom: { from: number; to: number } | undefined

  function enter(step: Step) {
    const stop = trip.stops[step.stop]
    if (step.kind === 'dwell') {
      options.onStop(step.stop)
      drawn(step.at)
      marker.setLngLat(stop.coordinates)
      const zoom = Math.max(map.getZoom(), 13)
      if (reducedMotion)
        map.jumpTo({ center: stop.coordinates, zoom, padding: getPadding() })
      else
        map.easeTo({
          center: stop.coordinates,
          zoom,
          padding: getPadding(),
          duration: 700,
        })
    } else {
      travelZoom = { from: map.getZoom(), to: zoomFor(step) }
    }
  }

  function render(now: number) {
    if (!playing) return
    const at = elapsed + (now - startedAt)
    if (at >= timeline.total) {
      elapsed = timeline.total
      drawn(timeline.length)
      finish()
      return
    }
    let index = stepIndex
    while (
      index + 1 < timeline.steps.length &&
      timeline.steps[index + 1].start <= at
    )
      index++
    if (index !== stepIndex) {
      stepIndex = index
      enter(timeline.steps[index])
    }
    const step = timeline.steps[index]
    if (step.kind === 'travel') {
      const t = Math.min(1, (at - step.start) / step.duration)
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
      const along = step.from + (step.to - step.from) * eased
      const point = pointAlong(timeline.path, timeline.cumulative, along)
      drawn(along)
      marker.setLngLat(point)
      const zoomT = Math.min(1, t / 0.3)
      const zoom = travelZoom
        ? travelZoom.from + (travelZoom.to - travelZoom.from) * zoomT
        : map.getZoom()
      map.jumpTo({ center: point, zoom, padding: getPadding() })
    }
    frame = requestAnimationFrame(render)
  }

  function setPlaying(next: boolean) {
    if (playing === next) return
    playing = next
    options.onPlayingChange(next)
  }

  function play() {
    if (playing) return
    if (finished) {
      finished = false
      elapsed = 0
      stepIndex = -1
      drawn(0)
    }
    map.stop()
    startedAt = performance.now()
    setPlaying(true)
    frame = requestAnimationFrame(render)
  }

  function pause() {
    if (!playing) return
    cancelAnimationFrame(frame)
    elapsed += performance.now() - startedAt
    setPlaying(false)
  }

  function finish() {
    cancelAnimationFrame(frame)
    finished = true
    setPlaying(false)
    options.onEnd()
  }

  // 换底图前页面会先退出回放，所以图层只加一次。
  addLayers()
  // 图层加好之后才放标记，加图层失败时地图上不会留下孤立的标记。
  marker.addTo(map)

  return {
    play,
    toggle() {
      if (playing) pause()
      else play()
    },
    /** 退出回放：拆掉图层与标记，恢复总览图层。 */
    destroy() {
      cancelAnimationFrame(frame)
      playing = false
      marker.remove()
      if (map.getLayer(LINE_LAYER)) map.removeLayer(LINE_LAYER)
      if (map.getLayer(PLANNED_LAYER)) map.removeLayer(PLANNED_LAYER)
      if (map.getSource(LINE_SOURCE)) map.removeSource(LINE_SOURCE)
      tripMap.setBaseLayersVisible(true)
    },
  }
}

export type Replay = Awaited<ReturnType<typeof createReplay>>
