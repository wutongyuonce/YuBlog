/**
 * 旅程回放：按一条时间线逐天开场、逐站停留、逐段画线，标记带着交通方式的图标沿线前进、
 * 镜头跟随；可以暂停、倍速、跳到上一站或下一站。减少动态效果时不画动画，只逐站切换。
 * 时间线是纯数据（`buildTimeline`），地图图层与帧循环在 `createReplay`。
 */
import type {
  ExpressionSpecification,
  GeoJSONSource,
  Marker,
  PaddingOptions,
} from 'maplibre-gl'

import { haversine as distance } from './geo.mjs'
import type { TripGeo, TripMap } from './trip-map'

/** 每张照片在卡片上停留的时长；站点停留至少 `MIN_DWELL_MS`，照片多时按张数延长。 */
export const PHOTO_MS = 1500
const MIN_DWELL_MS = 3000
const DAY_MS = 1800
const REDUCED_DWELL_MS = 3000
const MIN_TRAVEL_MS = 1200
const MAX_TRAVEL_MS = 4500
const MS_PER_KM = 450
export const SPEEDS = [1, 1.5, 2] as const
const MAX_TRAVEL_ZOOM = 15
const LINE_SOURCE = 'trips-replay'
const LINE_LAYER = 'trips-replay'
const PLANNED_LAYER = 'trips-replay-planned'
const STOPS_SOURCE = 'trips-replay-stops'
const STOPS_LAYER = 'trips-replay-stops'

type Step =
  | {
      kind: 'day'
      day: number
      /** 这一天的第一站。 */
      stop: number
      start: number
      duration: number
      at: number
    }
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
      mode: string
      start: number
      duration: number
      from: number
      to: number
    }

/** Web 墨卡托坐标（0–1），与地图 `line-progress` 的度量一致。 */
function mercator([lng, lat]: [number, number]) {
  const sin = Math.sin((lat * Math.PI) / 180)
  return [
    (lng + 180) / 360,
    0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI),
  ]
}

/** 站点停留：至少三秒，照片多时每张一秒半，让每张都轮到一次。 */
export function dwellFor(photos: number) {
  return Math.max(MIN_DWELL_MS, photos * PHOTO_MS)
}

/**
 * 全程路径、沿线累计距离与时间线。路段的 `from`／`to` 是沿线距离（米）。
 * `projected` 是同一条路径在墨卡托平面上的累计长度，只用来换算画线进度。
 * 每天第一站前有一段开场，卡片先写这一天。
 * @param photosOf 某站的照片张数，决定停留时长
 */
export function buildTimeline(
  trip: TripGeo,
  reducedMotion: boolean,
  photosOf: (index: number) => number = () => 0
) {
  const path: [number, number][] = []
  const cumulative: number[] = []
  const projected: number[] = []
  const legs = new Map<number, { from: number; to: number; mode: string }>()
  const stopAt = new Map<number, number>()
  const push = (point: [number, number]) => {
    const last = path.at(-1)
    if (last && last[0] === point[0] && last[1] === point[1]) return
    cumulative.push(last ? cumulative.at(-1)! + distance(last, point) : 0)
    if (last) {
      const [x1, y1] = mercator(last)
      const [x2, y2] = mercator(point)
      projected.push(projected.at(-1)! + Math.hypot(x2 - x1, y2 - y1))
    } else projected.push(0)
    path.push(point)
  }
  for (const stop of trip.stops) {
    const leg = trip.legs.find((item) => item.from === stop.index)
    push(stop.coordinates)
    stopAt.set(stop.index, cumulative.at(-1)!)
    if (!leg) continue
    const from = cumulative.at(-1)!
    for (const point of leg.path) push(point)
    legs.set(stop.index, { from, to: cumulative.at(-1)!, mode: leg.mode })
  }

  const steps: Step[] = []
  let clock = 0
  for (const stop of trip.stops) {
    const at = stopAt.get(stop.index)!
    if (stop.number === 1) {
      steps.push({
        kind: 'day',
        day: stop.day,
        stop: stop.index,
        start: clock,
        duration: DAY_MS,
        at,
      })
      clock += DAY_MS
    }
    const dwell = reducedMotion
      ? REDUCED_DWELL_MS
      : dwellFor(photosOf(stop.index))
    steps.push({
      kind: 'dwell',
      stop: stop.index,
      start: clock,
      duration: dwell,
      at,
    })
    clock += dwell
    const leg = legs.get(stop.index)
    if (!leg || reducedMotion) continue
    const km = (leg.to - leg.from) / 1000
    const duration = Math.min(
      MAX_TRAVEL_MS,
      Math.max(MIN_TRAVEL_MS, km * MS_PER_KM)
    )
    steps.push({
      kind: 'travel',
      stop: stop.index,
      start: clock,
      duration,
      ...leg,
    })
    clock += duration
  }
  return {
    path,
    cumulative,
    projected,
    steps,
    total: clock,
    length: cumulative.at(-1) ?? 0,
  }
}

/** 沿线距离 `at` 落在哪一小段，以及在段内的比例。 */
function locate(cumulative: number[], at: number) {
  if (cumulative.length < 2 || at <= 0) return { low: 0, high: 0, t: 0 }
  const last = cumulative.length - 1
  if (at >= cumulative[last]) return { low: last, high: last, t: 0 }
  let low = 0
  let high = last
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (cumulative[middle] <= at) low = middle
    else high = middle
  }
  const span = cumulative[high] - cumulative[low] || 1
  return { low, high, t: (at - cumulative[low]) / span }
}

/** 沿线距离 `at` 处的坐标。 */
export function pointAlong(
  path: [number, number][],
  cumulative: number[],
  at: number
): [number, number] {
  const { low, high, t } = locate(cumulative, at)
  return [
    path[low][0] + (path[high][0] - path[low][0]) * t,
    path[low][1] + (path[high][1] - path[low][1]) * t,
  ]
}

/** 沿线距离 `at` 对应的画线进度（0–1），按墨卡托长度换算，线头与标记对齐。 */
export function drawnRatio(
  timeline: Pick<ReturnType<typeof buildTimeline>, 'cumulative' | 'projected'>,
  at: number
): number {
  const total = timeline.projected.at(-1) ?? 0
  if (total === 0) return at > 0 ? 1 : 0
  const { low, high, t } = locate(timeline.cumulative, at)
  const { projected } = timeline
  return (projected[low] + (projected[high] - projected[low]) * t) / total
}

/** 某站停留步骤在时间线里的位置；跳站时用。 */
export function dwellStepOf(steps: Step[], stop: number) {
  return steps.findIndex((step) => step.kind === 'dwell' && step.stop === stop)
}

export interface ReplayOptions {
  tripMap: TripMap
  trip: TripGeo
  getPadding: () => PaddingOptions
  photosOf: (index: number) => number
  /** 新的一天开场。 */
  onDay: (day: number) => void
  /** 到达某站（停留开始）。 */
  onStop: (index: number) => void
  /** 当前站及该站时段（停留+路途）的完成比例（0–1），用于更新进度条。 */
  onProgress?: (stop: number, ratio: number) => void
  onPlayingChange: (playing: boolean) => void
  onEnd: () => void
}

export async function createReplay(options: ReplayOptions) {
  const { tripMap, trip, getPadding } = options
  const { map } = tripMap
  const maplibregl = await import('maplibre-gl')
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  const timeline = buildTimeline(trip, reducedMotion, options.photosOf)
  const head = tripMap.createRouteHead()
  head.set({ color: trip.color })
  const marker: Marker = new maplibregl.Marker({
    anchor: 'center',
    element: head.element,
  }).setLngLat(timeline.path[0])
  const stopLabelEl = document.createElement('span')
  stopLabelEl.className = 'trips-stop-label'
  const stopLabelMarker: Marker = new maplibregl.Marker({
    anchor: 'top',
    offset: [0, 14],
    element: stopLabelEl,
  })

  let elapsed = 0
  let startedAt = 0
  let frame = 0
  let playing = false
  let stepIndex = -1
  let finished = false
  let speed = 1

  function stopFeatures(reached: number) {
    return {
      type: 'FeatureCollection' as const,
      features: trip.stops.map((stop) => ({
        type: 'Feature' as const,
        properties: { visited: stop.index <= reached },
        geometry: { type: 'Point' as const, coordinates: stop.coordinates },
      })),
    }
  }

  function removeLayers() {
    if (map.getLayer(STOPS_LAYER)) map.removeLayer(STOPS_LAYER)
    if (map.getSource(STOPS_SOURCE)) map.removeSource(STOPS_SOURCE)
    if (map.getLayer(LINE_LAYER)) map.removeLayer(LINE_LAYER)
    if (map.getLayer(PLANNED_LAYER)) map.removeLayer(PLANNED_LAYER)
    if (map.getSource(LINE_SOURCE)) map.removeSource(LINE_SOURCE)
  }

  /** 加到一半失败时拆掉已加的部分，不给下一次回放留下半套图层。 */
  function addLayers() {
    try {
      addLayersOnce()
    } catch (error) {
      removeLayers()
      throw error
    }
  }

  function addLayersOnce() {
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
    map.addSource(STOPS_SOURCE, {
      type: 'geojson',
      data: stopFeatures(0),
    })
    map.addLayer({
      id: STOPS_LAYER,
      type: 'circle',
      source: STOPS_SOURCE,
      paint: {
        'circle-color': ['case', ['get', 'visited'], '#fff', 'rgba(0,0,0,0)'],
        'circle-radius': ['case', ['get', 'visited'], 4.5, 3.5],
        'circle-stroke-color': trip.color,
        'circle-stroke-width': 2,
      },
    })
    tripMap.setBaseLayersVisible(false)
  }

  /** 路线进度 `ratio` 之前着色、之后透明。数据只发一次，每帧只改这个表达式。 */
  function progress(ratio: number): ExpressionSpecification {
    const safe = Math.max(1e-5, Math.min(1, ratio))
    return ['step', ['line-progress'], trip.color, safe, 'rgba(0, 0, 0, 0)']
  }

  function drawn(at: number) {
    if (!map.getLayer(LINE_LAYER)) return
    map.setPaintProperty(
      LINE_LAYER,
      'line-gradient',
      progress(drawnRatio(timeline, at))
    )
  }

  /** 标记在路上时显示交通方式的图标与日期时刻，到站后是圆点并展示站点名称标签。 */
  function updateHead(step: Step) {
    const stop = trip.stops[step.stop]
    ;(map.getSource(STOPS_SOURCE) as GeoJSONSource | undefined)?.setData(
      stopFeatures(step.stop)
    )
    if (step.kind === 'travel') {
      head.set({ color: trip.color, mode: step.mode, stop })
      stopLabelMarker.remove()
    } else if (step.kind === 'day') {
      head.set({ color: trip.color })
      stopLabelMarker.remove()
    } else {
      head.set({ color: trip.color, stop })
      stopLabelEl.textContent = stop.name
      stopLabelMarker.setLngLat(stop.coordinates).addTo(map)
    }
  }

  function zoomFor(step: Extract<Step, { kind: 'travel' }>) {
    const from = timeline.cumulative.findIndex((value) => value >= step.from)
    const to = timeline.cumulative.findIndex((value) => value >= step.to)
    const camera = tripMap.cameraFor(
      timeline.path.slice(from, to + 1),
      getPadding(),
      MAX_TRAVEL_ZOOM
    )
    return Math.min(MAX_TRAVEL_ZOOM, camera?.zoom ?? map.getZoom())
  }

  let travelZoom: { from: number; to: number } | undefined

  function moveTo(center: [number, number], zoom: number) {
    if (reducedMotion) map.jumpTo({ center, zoom, padding: getPadding() })
    else map.easeTo({ center, zoom, padding: getPadding(), duration: 700 })
  }

  function enter(step: Step) {
    const stop = trip.stops[step.stop]
    updateHead(step)
    if (step.kind === 'travel') {
      travelZoom = { from: map.getZoom(), to: zoomFor(step) }
      return
    }
    drawn(step.at)
    marker.setLngLat(stop.coordinates)
    if (step.kind === 'day') {
      options.onDay(step.day)
      // 开场时框住这一天，看清当天要去的地方。
      const points = trip.stops
        .filter((item) => item.day === step.day)
        .map((item) => item.coordinates)
      const camera = tripMap.cameraFor(points, getPadding(), 14)
      if (camera && points.length > 1)
        reducedMotion
          ? map.jumpTo(camera)
          : map.easeTo({ ...camera, duration: 900 })
      else moveTo(stop.coordinates, Math.max(map.getZoom(), 13))
      return
    }
    options.onStop(step.stop)
    moveTo(stop.coordinates, Math.max(map.getZoom(), 13))
  }

  function reportProgress(step: Step, at: number) {
    if (!options.onProgress) return
    if (step.kind === 'day') {
      options.onProgress(step.stop, 0)
      return
    }
    const dwellIdx = dwellStepOf(timeline.steps, step.stop)
    const dwellStep = timeline.steps[dwellIdx]
    const nextStep = timeline.steps[dwellIdx + 1]
    const start = dwellStep?.start ?? step.start
    const end =
      nextStep?.kind === 'travel' && nextStep.stop === step.stop
        ? nextStep.start + nextStep.duration
        : (dwellStep?.start ?? step.start) +
          (dwellStep?.duration ?? step.duration)
    const span = Math.max(1, end - start)
    options.onProgress(step.stop, Math.max(0, Math.min(1, (at - start) / span)))
  }

  function render(now: number) {
    if (!playing) return
    try {
      const at = elapsed + (now - startedAt) * speed
      if (at >= timeline.total) {
        elapsed = timeline.total
        drawn(timeline.length)
        options.onProgress?.(trip.stops.length - 1, 1)
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
      reportProgress(step, at)
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
    } catch (error) {
      console.error(error)
    }
    if (playing) frame = requestAnimationFrame(render)
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
    render(startedAt)
  }

  function pause() {
    if (!playing) return
    cancelAnimationFrame(frame)
    elapsed += (performance.now() - startedAt) * speed
    setPlaying(false)
  }

  function finish() {
    cancelAnimationFrame(frame)
    finished = true
    setPlaying(false)
    options.onEnd()
  }

  /** 当前所在的站：停留时是这一站，路上是刚离开的那站，开场是当天第一站。 */
  function currentStop() {
    return timeline.steps[Math.max(0, stepIndex)].stop
  }

  /** 跳到某站开始停留；播放中继续播放，暂停时停在那里。 */
  function seek(stop: number) {
    const index = dwellStepOf(timeline.steps, stop)
    if (index < 0) return
    finished = false
    elapsed = timeline.steps[index].start
    startedAt = performance.now()
    stepIndex = index
    enter(timeline.steps[index])
    options.onProgress?.(stop, 0)
  }

  // 换底图前页面会先退出回放，所以图层只加一次。
  addLayers()
  // 图层加好之后才放标记，加图层失败时地图上不会留下孤立的标记。
  marker.addTo(map)

  return {
    play,
    seek,
    toggle() {
      if (playing) pause()
      else play()
    },
    previous() {
      seek(Math.max(0, currentStop() - 1))
    },
    /** 下一站；开场卡时直接进当天第一站，在路上时去下一站。 */
    next() {
      const current = timeline.steps[Math.max(0, stepIndex)]
      const target = current?.kind === 'day' ? current.stop : currentStop() + 1
      seek(Math.min(trip.stops.length - 1, target))
    },
    /** 改倍速；已走过的时间按旧倍速结算。 */
    setSpeed(next: number) {
      if (playing) {
        const now = performance.now()
        elapsed += (now - startedAt) * speed
        startedAt = now
      }
      speed = next
    },
    /** 退出回放：拆掉图层与标记，恢复总览图层。 */
    destroy() {
      cancelAnimationFrame(frame)
      playing = false
      marker.remove()
      stopLabelMarker.remove()
      removeLayers()
      tripMap.setBaseLayersVisible(true)
    },
  }
}

export type Replay = Awaited<ReturnType<typeof createReplay>>
