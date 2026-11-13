/**
 * 旅行页的地图（MapLibre GL + OpenFreeMap 底图）：全部路线、照片标记与叠片聚合、
 * 年份筛选、选中旅程的按天序号点与当天聚焦、悬停提示，以及按设置应用底图风格和 3D 视角。
 * 只管地图；面板、地址片段和回放由页面脚本与 `trip-replay.ts` 调度。
 */
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  LngLatBoundsLike,
  Map as MaplibreMap,
  MapMouseEvent,
  Marker,
  PaddingOptions,
  Popup,
} from 'maplibre-gl'
// 打包后 worker 不在 MapLibre 默认推算的位置，由 Vite 给出实际地址。
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

import { haversine } from './geo.mjs'
import {
  isDarkMapStyle,
  mapStyleUrl,
  pitchAtZoom,
  resolveMapStyle,
} from './trip-map-settings.js'
import { ROUTE_MODE_ICONS } from './trips.js'

export interface MapSettings {
  style: string
  tilt: boolean
}

/** 形状见 `tripMapData`（trips.js）。 */
export interface TripStopGeo {
  name: string
  coordinates: [number, number]
  /** 全程序号，0 起。 */
  index: number
  /** 第几天，0 起。 */
  day: number
  /** 当天序号，1 起。 */
  number: number
  date?: string
  time?: string
  photo?: string
}

export interface TripLegGeo {
  from: number
  day: number
  mode: string
  path: [number, number][]
}

export interface TripGeo {
  id: string
  title: string
  dates: string
  color: string
  year: number
  stops: TripStopGeo[]
  legs: TripLegGeo[]
}

/** 形状见 `calendarMapData`（calendar.js）。 */
export interface CalendarGeo {
  id: string
  hash: string
  title: string
  date: string
  place: string
  coordinates: [number, number]
  year: number
  color: string
  photo?: string
}

export interface MapData {
  years: { year: number; color: string }[]
  trips: TripGeo[]
  calendar: CalendarGeo[]
}

export interface TripMapOptions {
  container: HTMLElement
  data: MapData
  /** 站点是否为深色主题。 */
  dark: boolean
  settings: MapSettings
  /** 地图四周被面板等遮住的部分，取景时让开。 */
  getPadding: () => PaddingOptions
  onSelectTrip: (id: string) => void
  onSelectEntry: (id: string) => void
  onSelectStop: (index: number) => void
  onError: (message: string) => void
}

interface PinItem {
  key: string
  name: string
  coordinates: [number, number]
  year: number
  color: string
  photo?: string
  trip?: string
  entry?: string
  meta: string
  title: string
}

interface ClusterInfo {
  coordinates: [number, number]
  year: number
  color: string
  members: PinItem[]
}

const SOURCES = {
  routes: 'trips-routes',
  selected: 'trips-selected',
} as const
const LAYERS = {
  routes: 'trips-routes',
  flights: 'trips-routes-flight',
  selected: 'trips-selected',
  selectedNumber: 'trips-selected-number',
} as const
const BUILDINGS = 'trips-buildings'
/** OpenFreeMap 各样式共用的矢量源与建筑图层。 */
const BASEMAP_SOURCE = 'openmaptiles'
// OpenFreeMap 的字形服务只提供 Noto Sans；中文字形由浏览器本地字体绘制。
const FONT = ['Noto Sans Bold']
const EMPTY = { type: 'FeatureCollection' as const, features: [] }
/** 底图地名优先简体中文。 */
const CHINESE_NAME: ExpressionSpecification = [
  'coalesce',
  ['get', 'name:zh-Hans'],
  ['get', 'name:zh'],
  ['get', 'name'],
]
const IS_FLIGHT: FilterSpecification = ['==', ['get', 'mode'], 'flight']
const NOT_FLIGHT: FilterSpecification = ['!=', ['get', 'mode'], 'flight']
/** 屏幕像素距离在此之内、且至少 `CLUSTER_MIN_POINTS` 个点时合为一叠。 */
const CLUSTER_RADIUS_PX = 44
const CLUSTER_MIN_POINTS = 2
const CLUSTER_MAX_ZOOM = 14

/** 一组坐标的外接框；空数组返回 undefined。 */
function boundsOf(points: [number, number][]): LngLatBoundsLike | undefined {
  if (points.length === 0) return undefined
  let [west, south] = points[0]
  let [east, north] = points[0]
  for (const [lng, lat] of points) {
    west = Math.min(west, lng)
    east = Math.max(east, lng)
    south = Math.min(south, lat)
    north = Math.max(north, lat)
  }
  return [
    [west, south],
    [east, north],
  ]
}

/** 经纬度在给定整数缩放级别下的墨卡托像素坐标（512px 瓦片，与 Mapbox/MapLibre 聚合一致）。 */
function projectAtZoom([lng, lat]: [number, number], zoom: number) {
  const scale = 512 * 2 ** zoom
  const x = ((lng + 180) / 360) * scale
  const sin = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180)
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale
  return [x, y] as const
}

/** 沿一段路径按比例（0–1）取坐标。 */
function interpolateAlong(
  path: [number, number][],
  fraction: number
): [number, number] {
  if (path.length === 0) return [0, 0]
  if (path.length === 1 || fraction <= 0) return path[0]
  if (fraction >= 1) return path.at(-1)!
  const cumulative = [0]
  for (let i = 1; i < path.length; i++)
    cumulative.push(cumulative[i - 1] + haversine(path[i - 1], path[i]))
  const total = cumulative.at(-1)!
  if (total <= 0) return path[0]
  const target = total * fraction
  let i = 1
  while (i < cumulative.length - 1 && cumulative[i] < target) i++
  const span = cumulative[i] - cumulative[i - 1] || 1
  const t = (target - cumulative[i - 1]) / span
  return [
    path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t,
    path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t,
  ]
}

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`)

/** 沿途移动的线头标记：圆形交通图标 + 右侧「日期／第 N 天 HH:mm」胶囊。 */
export function createRouteHead() {
  const root = document.createElement('span')
  root.className = 'trips-replay-head'
  const badge = document.createElement('span')
  badge.className = 'trips-replay-head__badge'
  const icon = document.createElement('span')
  icon.setAttribute('aria-hidden', 'true')
  badge.append(icon)
  const clock = document.createElement('span')
  clock.className = 'trips-replay-head__clock'
  clock.hidden = true
  const dateLine = document.createElement('small')
  const dayLine = document.createElement('strong')
  clock.append(dateLine, dayLine)
  root.append(badge, clock)
  return {
    element: root,
    set(options: {
      color?: string
      mode?: string
      stop?: Pick<TripStopGeo, 'day' | 'date' | 'time'>
    }) {
      if (options.color) root.style.setProperty('--trip-color', options.color)
      const moving = Boolean(options.mode)
      root.classList.toggle('trips-replay-head--moving', moving)
      icon.className = options.mode
        ? (ROUTE_MODE_ICONS[options.mode as keyof typeof ROUTE_MODE_ICONS] ??
          '')
        : ''
      if (options.stop) {
        dateLine.textContent = options.stop.date ?? ''
        dateLine.hidden = !options.stop.date
        dayLine.textContent = `第 ${options.stop.day + 1} 天${options.stop.time ? ` ${options.stop.time}` : ''}`
        clock.hidden = false
      } else {
        clock.hidden = true
      }
    },
  }
}

const reducedMotion = () =>
  matchMedia('(prefers-reduced-motion: reduce)').matches

export async function createTripMap(options: TripMapOptions) {
  const { container, data, getPadding } = options
  const { years, trips, calendar } = data
  const maplibregl = await import('maplibre-gl')
  maplibregl.setWorkerUrl(workerUrl)
  const byId = new Map(trips.map((trip) => [trip.id, trip]))
  const entries = new Map(calendar.map((entry) => [entry.id, entry]))
  const yearColors = new Map(years.map(({ year, color }) => [year, color]))

  const allPins: PinItem[] = [
    ...trips.flatMap((trip) => {
      // 同一段旅程里重复造访的同名地点（如连住几晚的酒店）合并为一个总览点，优先保留有照片的那次。
      const unique = new Map<string, TripStopGeo>()
      for (const stop of trip.stops) {
        const prev = unique.get(stop.name)
        if (!prev || (!prev.photo && stop.photo)) unique.set(stop.name, stop)
      }
      return [...unique.values()].map((stop) => ({
        key: `${trip.id}:${stop.index}`,
        name: stop.name,
        coordinates: stop.coordinates,
        year: trip.year,
        color: trip.color,
        photo: stop.photo,
        trip: trip.id,
        meta: `${trip.dates} · ${stop.name}`,
        title: trip.title,
      }))
    }),
    ...calendar.map((entry) => ({
      key: `calendar:${entry.id}`,
      name: entry.place,
      coordinates: entry.coordinates,
      year: entry.year,
      color: entry.color,
      photo: entry.photo,
      entry: entry.id,
      meta: `${entry.date} · ${entry.place}`,
      title: entry.title,
    })),
  ]

  const pointsOf = (pickedYear?: number) =>
    allPins
      .filter((pin) => pickedYear === undefined || pin.year === pickedYear)
      .map((pin) => pin.coordinates)
  const allPoints = pointsOf()

  let selected: string | undefined
  let selectedEntry: string | undefined
  let lifted: string | undefined
  let activeStop: number | undefined
  let focusedDay: number | undefined
  let year: number | undefined
  let baseVisible = true
  let style = resolveMapStyle(options.settings, options.dark)
  let tilt = options.settings.tilt
  let destroyed = false
  let failed = false
  let loaded = false
  /** 当前底图已加载且旅程图层已加上；换主题重新加载底图期间为 false。 */
  let ready = false

  const map: MaplibreMap = new maplibregl.Map({
    container,
    style: mapStyleUrl(style),
    bounds: boundsOf(allPoints) ?? [
      [73, 18],
      [135, 54],
    ],
    fitBoundsOptions: { padding: getPadding(), maxZoom: 10 },
    attributionControl: false,
  })
  // OpenFreeMap 要求保留署名。
  map.addControl(
    new maplibregl.AttributionControl({ compact: true }),
    'bottom-left'
  )

  // 只在首次加载完成前上报；之后个别瓦片失败不打断浏览。
  map.once('load', () => (loaded = true))
  map.on('error', (event) => {
    if (failed || loaded) return
    failed = true
    console.error(event.error)
    options.onError('地图暂时无法加载，旅程仍可在面板里浏览。')
  })

  // `pointer-events: none` 让弹出框绝不会挡住下面的标记，避免悬停闪烁。
  const popup: Popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 24,
    className: 'trips-popup',
  })

  function routeFeatures() {
    return {
      type: 'FeatureCollection' as const,
      features: trips.flatMap((trip) =>
        trip.legs.map((leg) => ({
          type: 'Feature' as const,
          properties: {
            trip: trip.id,
            color: trip.color,
            year: trip.year,
            day: leg.day,
            mode: leg.mode,
          },
          geometry: { type: 'LineString' as const, coordinates: leg.path },
        }))
      ),
    }
  }

  function selectedFeatures() {
    const trip = selected ? byId.get(selected) : undefined
    if (!trip) return EMPTY
    return {
      type: 'FeatureCollection' as const,
      features: trip.stops.map((stop) => ({
        type: 'Feature' as const,
        properties: {
          index: stop.index,
          day: stop.day,
          number: String(stop.number),
          name: stop.name,
          color: trip.color,
        },
        geometry: { type: 'Point' as const, coordinates: stop.coordinates },
      })),
    }
  }

  // 详情滚动时的沿途游标（带交通工具图标与日期时刻）与当前站点名称胶囊。
  const scrollHead = createRouteHead()
  const scrollMarker: Marker = new maplibregl.Marker({
    anchor: 'center',
    element: scrollHead.element,
  })
  const stopLabelEl = document.createElement('span')
  stopLabelEl.className = 'trips-stop-label'
  const stopLabelMarker: Marker = new maplibregl.Marker({
    anchor: 'top',
    offset: [0, 14],
    element: stopLabelEl,
  })
  function hideScrollHead() {
    scrollMarker.remove()
  }
  function syncStopLabel() {
    const trip = selected ? byId.get(selected) : undefined
    const stop = activeStop !== undefined ? trip?.stops[activeStop] : undefined
    if (!baseVisible || !stop) {
      stopLabelMarker.remove()
      return
    }
    stopLabelEl.textContent = stop.name
    if (!stopLabelEl.isConnected) {
      placeOnMap(stopLabelMarker, stop.coordinates)
    } else {
      stopLabelMarker.setLngLat(stop.coordinates)
    }
  }
  const markers = new Map<string, Marker>()
  const markerCoords = new Map<string, [number, number]>()
  /** 放入地图前先把经纬度与像素坐标写好，避免等下一帧时闪在左上角。 */
  function placeOnMap(marker: Marker, coordinates: [number, number]) {
    marker.setLngLat(coordinates)
    const point = map.project(coordinates).round()
    marker.getElement().style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)`
    marker.addTo(map)
  }

  function createPhotoCard(src: string | undefined, withYearDot = false) {
    const frame = document.createElement('span')
    frame.className = 'trips-pin__photo'
    frame.setAttribute('aria-hidden', 'true')
    if (src) {
      const image = document.createElement('img')
      image.src = src
      image.alt = ''
      image.loading = 'lazy'
      image.decoding = 'async'
      frame.append(image)
    } else {
      const face = document.createElement('span')
      face.className = 'trips-pin__face'
      frame.append(face)
    }
    if (withYearDot) {
      const dot = document.createElement('span')
      dot.className = 'trips-pin__year'
      frame.append(dot)
    }
    return frame
  }

  function createSingleMarker(item: PinItem) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'trips-pin'
    button.style.setProperty('--trip-color', item.color)
    button.setAttribute('aria-label', `${item.meta} · ${item.title}`)
    if (item.photo) {
      button.append(createPhotoCard(item.photo, true))
    } else {
      const dot = document.createElement('span')
      dot.className = 'trips-pin__dot'
      dot.setAttribute('aria-hidden', 'true')
      button.append(dot)
    }
    const html = `<span>${escape(item.meta)}</span><strong>${escape(item.title)}</strong>`
    button.addEventListener('mouseenter', () => {
      if (selected) return
      popup.setLngLat(item.coordinates).setHTML(html).addTo(map)
      if (item.trip) lift(item.trip)
    })
    button.addEventListener('mouseleave', () => {
      popup.remove()
      lift(undefined)
    })
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      popup.remove()
      if (item.trip) options.onSelectTrip(item.trip)
      else if (item.entry) options.onSelectEntry(item.entry)
    })
    return new maplibregl.Marker({
      anchor: 'center',
      element: button,
    }).setLngLat(item.coordinates)
  }

  function createClusterMarker(cluster: ClusterInfo, zoom: number) {
    const { members } = cluster
    const count = members.length
    const lead = members.find((item) => item.photo) ?? members[0]
    const title = `${lead.name}等 ${count} 个地点`
    const meta = `${count} 条记录`
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'trips-pin trips-pin--cluster'
    button.style.setProperty('--trip-color', cluster.color)
    button.setAttribute('aria-label', `${meta} · ${title}`)

    // 三张扇形叠片：取前 3 张照片（不足用年份色片补齐），最后一张在最上面。
    const photos = members
      .flatMap((member) => (member.photo ? [member.photo] : []))
      .slice(0, 3)
    while (photos.length < 3) photos.push(undefined as unknown as string)
    const stack = document.createElement('span')
    stack.className = 'trips-pin__stack'
    stack.setAttribute('aria-hidden', 'true')
    for (const photo of photos.toReversed())
      stack.append(createPhotoCard(photo))
    const badge = document.createElement('span')
    badge.className = 'trips-pin__count'
    badge.setAttribute('aria-hidden', 'true')
    badge.textContent = String(count)
    button.append(stack, badge)

    const html = `<span>${escape(meta)}</span><strong>${escape(title)}</strong>`
    button.addEventListener('mouseenter', () => {
      if (selected) return
      popup.setLngLat(cluster.coordinates).setHTML(html).addTo(map)
    })
    button.addEventListener('mouseleave', () => popup.remove())
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      popup.remove()
      const points = members.map((member) => member.coordinates)
      const bounds = boundsOf(points) as
        [[number, number], [number, number]] | undefined
      const span =
        bounds &&
        Math.hypot(bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1])
      if (zoom >= CLUSTER_MAX_ZOOM || !span || span < 0.0002) {
        if (lead.trip) options.onSelectTrip(lead.trip)
        else if (lead.entry) options.onSelectEntry(lead.entry)
        return
      }
      const padding = safePadding(getPadding())
      const framed = cameraFor(points, padding, 13)
      const targetZoom = Math.min(
        15,
        Math.max(framed?.zoom ?? zoom + 2, zoom + 2)
      )
      map.easeTo({
        center:
          (framed?.center as [number, number] | undefined) ??
          cluster.coordinates,
        zoom: targetZoom,
        padding,
        pitch: tilt ? pitchAtZoom(targetZoom) : 0,
        duration: reducedMotion() ? 0 : 750,
      })
    })
    return new maplibregl.Marker({
      anchor: 'center',
      element: button,
    }).setLngLat(cluster.coordinates)
  }

  /**
   * 按当前整数缩放级别在屏幕空间做确定性贪心聚合（有照片的点优先作种子），
   * 避免 MapLibre 瓦片边界分裂同一个城市的点，移动中也只在跨缩放级时变化。
   */
  let lastSyncKey = ''
  function syncMarkers(force = false) {
    if (!ready || !baseVisible || selected) {
      lastSyncKey = ''
      for (const marker of markers.values()) marker.remove()
      markers.clear()
      return
    }
    const zoom = Math.floor(map.getZoom())
    const syncKey = `${year ?? 'all'}:${zoom}:${selectedEntry ?? ''}`
    if (!force && syncKey === lastSyncKey) return
    lastSyncKey = syncKey

    const shown = allPins.filter(
      (pin) => year === undefined || pin.year === year
    )
    // 有照片、年份新的点优先作为聚合中心，保证叠片正面始终有代表照片。
    const ordered = shown.toSorted(
      (a, b) =>
        Number(Boolean(b.photo)) - Number(Boolean(a.photo)) || b.year - a.year
    )
    const projected = new Map(
      ordered.map((pin) => [pin, projectAtZoom(pin.coordinates, zoom)])
    )
    const used = new Set<PinItem>()
    const visible = new Map<string, () => Marker>()
    const radius2 = CLUSTER_RADIUS_PX * CLUSTER_RADIUS_PX

    for (const seed of ordered) {
      if (used.has(seed)) continue
      if (zoom > CLUSTER_MAX_ZOOM) {
        used.add(seed)
        markerCoords.set(seed.key, seed.coordinates)
        visible.set(seed.key, () => createSingleMarker(seed))
        continue
      }
      const [sx, sy] = projected.get(seed)!
      const members = ordered.filter((candidate) => {
        if (used.has(candidate)) return false
        const [cx, cy] = projected.get(candidate)!
        const dx = cx - sx
        const dy = cy - sy
        return dx * dx + dy * dy <= radius2
      })
      if (members.length < CLUSTER_MIN_POINTS) {
        used.add(seed)
        markerCoords.set(seed.key, seed.coordinates)
        visible.set(seed.key, () => createSingleMarker(seed))
        continue
      }
      for (const member of members) used.add(member)
      const lng =
        members.reduce((sum, item) => sum + item.coordinates[0], 0) /
        members.length
      const lat =
        members.reduce((sum, item) => sum + item.coordinates[1], 0) /
        members.length
      const latestYear = Math.max(...members.map((item) => item.year))
      const color = yearColors.get(latestYear) ?? seed.color
      const key = `cluster:${zoom}:${members.map((item) => item.key).join(',')}`
      markerCoords.set(key, [lng, lat])
      visible.set(key, () =>
        createClusterMarker(
          { coordinates: [lng, lat], year: latestYear, color, members },
          zoom
        )
      )
    }

    for (const [key, build] of visible) {
      const existing = markers.get(key)
      const marker = existing ?? build()
      markers.set(key, marker)
      marker
        .getElement()
        .classList.toggle(
          'is-active',
          Boolean(selectedEntry && key === `calendar:${selectedEntry}`)
        )
      if (!marker.getElement().isConnected) {
        placeOnMap(marker, markerCoords.get(key)!)
      }
    }
    for (const [key, marker] of markers)
      if (!visible.has(key)) {
        marker.remove()
        markers.delete(key)
        markerCoords.delete(key)
      }
  }

  /** 底图的地名标注改为中文；道路编号等非名称字段保持原样。 */
  function useChineseLabels() {
    for (const layer of map.getStyle().layers) {
      if (layer.type !== 'symbol') continue
      const field = map.getLayoutProperty(layer.id, 'text-field')
      if (field && JSON.stringify(field).includes('name')) {
        map.setLayoutProperty(layer.id, 'text-field', CHINESE_NAME)
      }
    }
  }

  /**
   * 3D 视角：倾斜角度跟随缩放，靠近街道时显示立体楼块；关闭时平视。
   * 底图自带的立体楼块一律隐藏，楼块只由这里管理，各风格表现一致。
   */
  function applyTilt() {
    map.setTransformCameraUpdate(({ zoom }) => ({
      pitch: tilt ? pitchAtZoom(zoom) : 0,
    }))
    // 镜头正在动时不打断，新的倾斜角在下一次镜头变化时生效。
    if (!map.isMoving())
      map.jumpTo({ pitch: tilt ? pitchAtZoom(map.getZoom()) : 0 })
    if (map.getLayer(BUILDINGS)) map.removeLayer(BUILDINGS)
    if (!tilt || !map.getSource(BASEMAP_SOURCE)) return
    map.addLayer(
      {
        'id': BUILDINGS,
        'type': 'fill-extrusion',
        'source': BASEMAP_SOURCE,
        'source-layer': 'building',
        'minzoom': 14,
        'filter': ['!', ['has', 'hide_3d']],
        'paint': {
          'fill-extrusion-color': isDarkMapStyle(style)
            ? '#2a2f3a'
            : 'hsl(35, 8%, 85%)',
          'fill-extrusion-base': ['get', 'render_min_height'],
          'fill-extrusion-height': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14,
            0,
            15,
            ['get', 'render_height'],
          ],
          'fill-extrusion-opacity': 0.8,
        },
      },
      map.getLayer(LAYERS.routes) ? LAYERS.routes : undefined
    )
  }

  function hideBasemapExtrusions() {
    for (const layer of map.getStyle().layers) {
      if (layer.type === 'fill-extrusion' && layer.id !== BUILDINGS)
        map.setLayoutProperty(layer.id, 'visibility', 'none')
    }
  }

  function addLayers() {
    useChineseLabels()
    hideBasemapExtrusions()
    if (map.getSource(SOURCES.routes)) return
    map.addSource(SOURCES.routes, { type: 'geojson', data: routeFeatures() })
    map.addSource(SOURCES.selected, {
      type: 'geojson',
      data: selectedFeatures(),
    })

    const width: ExpressionSpecification = [
      'interpolate',
      ['linear'],
      ['zoom'],
      3,
      2,
      12,
      4,
    ]
    map.addLayer({
      id: LAYERS.routes,
      type: 'line',
      source: SOURCES.routes,
      filter: NOT_FLIGHT,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': width },
    })
    // 飞机用粗虚线；虚线样式不能按要素取值，所以单独一层。
    map.addLayer({
      id: LAYERS.flights,
      type: 'line',
      source: SOURCES.routes,
      filter: IS_FLIGHT,
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 3, 12, 5],
        'line-dasharray': [1.5, 1.5],
      },
    })
    map.addLayer({
      id: LAYERS.selected,
      type: 'circle',
      source: SOURCES.selected,
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': 10,
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2,
      },
    })
    map.addLayer({
      id: LAYERS.selectedNumber,
      type: 'symbol',
      source: SOURCES.selected,
      layout: {
        'text-field': ['get', 'number'],
        'text-font': FONT,
        'text-size': 11,
        'text-allow-overlap': true,
        'icon-allow-overlap': true,
      },
      paint: { 'text-color': '#fff' },
    })
    applyState()
  }

  /** 选中、悬停、当天、当前站与年份决定各图层的可见度和强调。 */
  function applyState() {
    if (!map.getLayer(LAYERS.routes)) return
    const focus = selected ?? lifted
    const opacity: ExpressionSpecification | number = !focus
      ? 0.85
      : selected && focusedDay !== undefined
        ? [
            'case',
            ['!=', ['get', 'trip'], selected],
            0.08,
            ['==', ['get', 'day'], focusedDay],
            1,
            0.22,
          ]
        : ['case', ['==', ['get', 'trip'], focus], 1, 0.15]
    const yearFilter: FilterSpecification =
      year === undefined || selected ? true : ['==', ['get', 'year'], year]
    for (const [id, mode] of [
      [LAYERS.routes, NOT_FLIGHT],
      [LAYERS.flights, IS_FLIGHT],
    ] as const) {
      map.setPaintProperty(id, 'line-opacity', opacity)
      map.setFilter(id, ['all', mode, yearFilter] as FilterSpecification)
    }
    map.setFilter(
      LAYERS.selected,
      focusedDay === undefined ? null : ['==', ['get', 'day'], focusedDay]
    )
    map.setFilter(
      LAYERS.selectedNumber,
      focusedDay === undefined ? null : ['==', ['get', 'day'], focusedDay]
    )
    map.setPaintProperty(
      LAYERS.selected,
      'circle-radius',
      activeStop === undefined
        ? 10
        : ['case', ['==', ['get', 'index'], activeStop], 13, 9]
    )
    ;(map.getSource(SOURCES.selected) as GeoJSONSource).setData(
      selectedFeatures()
    )
    syncStopLabel()
    syncMarkers(true)
  }

  function safePadding(raw: PaddingOptions): Required<PaddingOptions> {
    const { clientWidth, clientHeight } = map.getContainer()
    const maxH = Math.max(48, Math.floor(clientHeight * 0.45))
    const maxW = Math.max(48, Math.floor(clientWidth * 0.45))
    return {
      top: Math.min(raw.top ?? 0, maxH),
      bottom: Math.min(raw.bottom ?? 0, maxH),
      left: Math.min(raw.left ?? 0, maxW),
      right: Math.min(raw.right ?? 0, maxW),
    }
  }

  /** 框住一组坐标的镜头（含 3D 下的倾斜），只计算不移动。`maxZoom` 传数字，避免 MapLibre `extend` 把 `undefined` 算成 NaN。 */
  function cameraFor(
    points: [number, number][],
    padding: PaddingOptions,
    maxZoom = 15
  ) {
    const bounds = boundsOf(points) as
      [[number, number], [number, number]] | undefined
    if (!bounds) return undefined
    const safe = safePadding(padding)
    if (
      Math.hypot(bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1]) <
      1e-4
    ) {
      return {
        center: bounds[0],
        zoom: maxZoom,
        padding: safe,
        pitch: tilt ? pitchAtZoom(maxZoom) : 0,
      }
    }
    const flat = map.cameraForBounds(bounds, {
      padding: safe,
      maxZoom,
      absolutePadding: true,
    })
    if (!flat) return undefined
    const zoom = flat.zoom ?? maxZoom
    return { ...flat, zoom, padding: safe, pitch: tilt ? pitchAtZoom(zoom) : 0 }
  }

  function fit(points: [number, number][], maxZoom = 14) {
    const camera = cameraFor(points, getPadding(), maxZoom)
    if (!camera) return
    map.easeTo({ ...camera, duration: reducedMotion() ? 0 : 900 })
  }

  function tripPoints(trip: TripGeo, day?: number) {
    return trip.legs
      .filter((leg) => day === undefined || leg.day === day)
      .flatMap((leg) => leg.path)
      .concat(
        trip.stops
          .filter((stop) => day === undefined || stop.day === day)
          .map((stop) => stop.coordinates)
      )
  }

  function lift(id: string | undefined) {
    if (lifted === id) return
    lifted = id
    if (!map.getLayer(LAYERS.routes)) return
    const focus = selected ?? lifted
    const opacity: ExpressionSpecification | number = !focus
      ? 0.85
      : ['case', ['==', ['get', 'trip'], focus], 1, 0.15]
    for (const layer of [LAYERS.routes, LAYERS.flights])
      map.setPaintProperty(layer, 'line-opacity', opacity)
  }

  function showPopup(event: MapMouseEvent, html: string) {
    popup.setLngLat(event.lngLat).setHTML(html).addTo(map)
  }

  // 构造时按平视取景；首次加载后按 3D 的倾斜重新框住总览，边缘的点不被裁掉。
  map.once('style.load', () => {
    const camera = cameraFor(allPoints, getPadding(), 10)
    if (camera) map.jumpTo(camera)
  })
  map.on('style.load', () => {
    addLayers()
    applyTilt()
    ready = true
    syncMarkers(true)
  })
  map.on('zoom', () => syncMarkers())
  map.on('moveend', () => syncMarkers())

  for (const layer of [LAYERS.routes, LAYERS.flights]) {
    map.on('click', layer, (event) => {
      const id = event.features?.[0]?.properties?.trip
      if (typeof id === 'string' && id !== selected) options.onSelectTrip(id)
    })
    map.on('mousemove', layer, (event) => {
      const trip = byId.get(event.features?.[0]?.properties?.trip)
      if (!trip || selected) return
      map.getCanvas().style.cursor = 'pointer'
      showPopup(
        event,
        `<span>${escape(trip.dates)}</span><strong>${escape(trip.title)}</strong>`
      )
    })
    map.on('mouseleave', layer, () => {
      map.getCanvas().style.cursor = ''
      popup.remove()
    })
  }
  map.on('click', LAYERS.selected, (event) => {
    const index = event.features?.[0]?.properties?.index
    if (typeof index === 'number') options.onSelectStop(index)
  })
  map.on('mousemove', LAYERS.selected, (event) => {
    const name = event.features?.[0]?.properties?.name
    map.getCanvas().style.cursor = 'pointer'
    if (typeof name === 'string')
      showPopup(event, `<strong>${escape(name)}</strong>`)
  })
  map.on('mouseleave', LAYERS.selected, () => {
    map.getCanvas().style.cursor = ''
    popup.remove()
  })

  return {
    map,
    createRouteHead,
    /** 能否在地图上加回放图层。瓦片加载中也可以，只有换底图时不行。 */
    ready: () => ready && !failed,
    trip: (id: string) => byId.get(id),
    hasEntry: (id: string) => entries.has(id),
    cameraFor,
    /** 打开某段旅程或回到总览（按筛选的年份取景）。 */
    select(id: string | undefined) {
      selected = id && byId.has(id) ? id : undefined
      selectedEntry = undefined
      activeStop = undefined
      focusedDay = undefined
      hideScrollHead()
      popup.remove()
      applyState()
      const trip = selected ? byId.get(selected) : undefined
      if (trip) fit(tripPoints(trip), 14)
      else fit(pointsOf(year), 10)
    },
    /** 打开一条日历记录：总览不变，镜头移到它并强调它的标记。 */
    selectEntry(id: string | undefined) {
      selected = undefined
      focusedDay = undefined
      activeStop = undefined
      hideScrollHead()
      selectedEntry = id && entries.has(id) ? id : undefined
      popup.remove()
      applyState()
      const entry = selectedEntry ? entries.get(selectedEntry) : undefined
      if (entry)
        map.easeTo({
          center: entry.coordinates,
          zoom: Math.max(map.getZoom(), 15),
          padding: safePadding(getPadding()),
          duration: reducedMotion() ? 0 : 900,
        })
    },
    /** 只看某一年，`undefined` 为全部年份。 */
    setYear(next: number | undefined) {
      if (year === next) return
      year = next
      applyState()
      if (!selected && !selectedEntry) fit(pointsOf(year), 10)
    },
    /** 选中旅程里聚焦某一天（`undefined` 恢复看整段旅程）：其它天的路线变淡、站点隐藏，镜头框住这一天。 */
    focusDay(day: number | undefined) {
      if (focusedDay === day || !selected) return
      focusedDay = day
      if (day === undefined) hideScrollHead()
      applyState()
      const trip = byId.get(selected)!
      const points = tripPoints(trip, day)
      if (points.length > 0) fit(points, day === undefined ? 14 : 15)
    },
    /** 面板滚动联动：在两站之间移动交通图标与日期时刻胶囊。 */
    setScrollProgress(progress?: { stopIndex: number; fraction: number }) {
      const trip = selected ? byId.get(selected) : undefined
      const stop = progress ? trip?.stops[progress.stopIndex] : undefined
      if (!trip || !progress || !stop) {
        hideScrollHead()
        return
      }
      const leg = trip.legs.find((item) => item.from === progress.stopIndex)
      const moving = Boolean(
        leg && progress.fraction > 0.02 && progress.fraction < 0.99
      )
      const point = moving
        ? interpolateAlong(leg!.path, progress.fraction)
        : stop.coordinates
      scrollHead.set({
        color: trip.color,
        mode: moving ? leg!.mode : undefined,
        stop,
      })
      if (!scrollHead.element.isConnected) {
        placeOnMap(scrollMarker, point)
      } else {
        scrollMarker.setLngLat(point)
      }
    },
    lift,
    /** 强调某站；`fly` 时把它移到视野中央，`reveal` 时只在它出了视野才平移过去。 */
    activateStop(
      index: number | undefined,
      move: 'fly' | 'reveal' | 'none' = 'none'
    ) {
      activeStop = index
      applyState()
      const trip = selected ? byId.get(selected) : undefined
      const stop = index === undefined ? undefined : trip?.stops[index]
      if (!stop || move === 'none') return
      if (move === 'reveal') {
        const { x, y } = map.project(stop.coordinates)
        const padding = getPadding()
        const { clientWidth, clientHeight } = map.getContainer()
        const { top = 0, right = 0, bottom = 0, left = 0 } = padding
        const inside =
          x > left &&
          x < clientWidth - right &&
          y > top &&
          y < clientHeight - bottom
        if (inside) return
        map.easeTo({
          center: stop.coordinates,
          padding,
          duration: reducedMotion() ? 0 : 600,
        })
        return
      }
      map.easeTo({
        center: stop.coordinates,
        zoom: Math.max(map.getZoom(), 14),
        padding: getPadding(),
        duration: reducedMotion() ? 0 : 700,
      })
    },
    /** 只隐藏或恢复总览与选中图层（含照片标记），回放画自己的线。 */
    setBaseLayersVisible(visible: boolean) {
      baseVisible = visible
      if (!visible) {
        hideScrollHead()
        stopLabelMarker.remove()
      }
      if (!map.getLayer(LAYERS.routes)) return
      for (const id of Object.values(LAYERS))
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
      if (visible) applyState()
      else syncMarkers(true)
    },
    /**
     * 站点主题或地图设置变化后调用。底图风格变了会重新加载样式，
     * 回放图层会随之消失，调用方先退出回放；只改 3D 视角时就地切换。
     */
    setAppearance(dark: boolean, settings: MapSettings) {
      const nextStyle = resolveMapStyle(settings, dark)
      const tiltChanged = settings.tilt !== tilt
      tilt = settings.tilt
      if (nextStyle !== style) {
        style = nextStyle
        ready = false
        // 不做样式差分，确保 `style.load` 触发并重新加上旅程图层。
        map.setStyle(mapStyleUrl(style), { diff: false })
      } else if (tiltChanged && ready) applyTilt()
    },
    resize() {
      map.resize()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      hideScrollHead()
      stopLabelMarker.remove()
      popup.remove()
      for (const marker of markers.values()) marker.remove()
      markers.clear()
      map.remove()
    },
  }
}

export type TripMap = Awaited<ReturnType<typeof createTripMap>>
