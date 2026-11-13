/**
 * 旅行页的地图（MapLibre GL + OpenFreeMap 底图）：全部路线、照片标记与聚合、
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

import {
  isDarkMapStyle,
  mapStyleUrl,
  pitchAtZoom,
  resolveMapStyle,
} from './trip-map-settings.js'

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

const SOURCES = {
  routes: 'trips-routes',
  points: 'trips-points',
  selected: 'trips-selected',
} as const
const LAYERS = {
  routes: 'trips-routes',
  flights: 'trips-routes-flight',
  points: 'trips-points-hit',
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

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`)

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
  const pointsOf = (year?: number) => [
    ...trips
      .filter((trip) => year === undefined || trip.year === year)
      .flatMap((trip) => trip.stops.map((stop) => stop.coordinates)),
    ...calendar
      .filter((entry) => year === undefined || entry.year === year)
      .map((entry) => entry.coordinates),
  ]
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

  const popup: Popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 16,
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

  /** 总览里的点：旅程各站与有地点的日历记录，按筛选的年份取。 */
  function pointFeatures() {
    const point = (
      coordinates: [number, number],
      properties: Record<string, unknown>
    ) => ({
      type: 'Feature' as const,
      properties,
      geometry: { type: 'Point' as const, coordinates },
    })
    return {
      type: 'FeatureCollection' as const,
      features: [
        ...trips
          .filter((trip) => year === undefined || trip.year === year)
          .flatMap((trip) =>
            trip.stops.map((stop) =>
              point(stop.coordinates, {
                key: `${trip.id}:${stop.index}`,
                trip: trip.id,
                color: trip.color,
                year: trip.year,
                photo: stop.photo,
              })
            )
          ),
        ...calendar
          .filter((entry) => year === undefined || entry.year === year)
          .map((entry) =>
            point(entry.coordinates, {
              key: `calendar:${entry.id}`,
              entry: entry.id,
              color: entry.color,
              year: entry.year,
              photo: entry.photo,
            })
          ),
      ],
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

  // —— 照片标记：总览的点与聚合用 HTML 标记画，随视野同步 ——
  const markers = new Map<string, Marker>()

  function pinElement(properties: Record<string, unknown>, count?: number) {
    const element = document.createElement('button')
    element.type = 'button'
    element.className = 'trips-pin'
    const color =
      properties.color ?? yearColors.get(Number(properties.year)) ?? '#f59e0b'
    element.style.setProperty('--trip-color', String(color))
    const photo = properties.photo
    if (typeof photo === 'string') {
      element.classList.add('trips-pin--photo')
      const image = document.createElement('img')
      image.src = photo
      image.alt = ''
      image.decoding = 'async'
      element.append(image)
    }
    if (count) {
      element.classList.add('trips-pin--cluster')
      const badge = document.createElement('span')
      badge.className = 'trips-pin__count'
      badge.textContent = String(count)
      element.append(badge)
    }
    return element
  }

  function describe(properties: Record<string, unknown>) {
    const trip =
      typeof properties.trip === 'string'
        ? byId.get(properties.trip)
        : undefined
    if (trip)
      return `<span>${escape(trip.dates)}</span><strong>${escape(trip.title)}</strong>`
    const entry =
      typeof properties.entry === 'string'
        ? entries.get(properties.entry)
        : undefined
    return entry
      ? `<span>${escape(entry.date)} · ${escape(entry.place)}</span><strong>${escape(entry.title)}</strong>`
      : ''
  }

  function createMarker(
    key: string,
    coordinates: [number, number],
    properties: Record<string, unknown>
  ) {
    const clusterId = properties.cluster_id as number | undefined
    const count = properties.point_count as number | undefined
    const element = pinElement(properties, count)
    const label = count ? `${count} 个地点，放大查看` : describe(properties)
    element.setAttribute(
      'aria-label',
      count ? label : label.replace(/<[^>]+>/g, ' ').trim()
    )
    element.addEventListener('click', (event) => {
      event.stopPropagation()
      popup.remove()
      if (clusterId !== undefined) {
        ;(map.getSource(SOURCES.points) as GeoJSONSource)
          .getClusterExpansionZoom(clusterId)
          .then((zoom) =>
            map.easeTo({ center: coordinates, zoom: Math.min(zoom, 16) })
          )
          .catch(() => undefined)
      } else if (typeof properties.trip === 'string')
        options.onSelectTrip(properties.trip)
      else if (typeof properties.entry === 'string')
        options.onSelectEntry(properties.entry)
    })
    if (!count) {
      element.addEventListener('pointerenter', () => {
        if (selected) return
        popup.setLngLat(coordinates).setHTML(describe(properties)).addTo(map)
        if (typeof properties.trip === 'string') lift(properties.trip)
      })
      element.addEventListener('pointerleave', () => {
        popup.remove()
        lift(undefined)
      })
    }
    const marker = new maplibregl.Marker({ element }).setLngLat(coordinates)
    markers.set(key, marker)
    return marker
  }

  /** 按当前视野里的点与聚合增删标记；选中旅程或回放时不显示。 */
  function syncMarkers() {
    const visible = new Set<string>()
    if (
      ready &&
      baseVisible &&
      !selected &&
      map.getSource(SOURCES.points) &&
      map.isSourceLoaded(SOURCES.points)
    ) {
      for (const feature of map.querySourceFeatures(SOURCES.points)) {
        if (feature.geometry.type !== 'Point') continue
        const properties = feature.properties ?? {}
        const key =
          properties.cluster_id !== undefined
            ? `cluster:${year ?? 'all'}:${properties.cluster_id}:${properties.point_count}`
            : String(properties.key)
        if (visible.has(key)) continue
        visible.add(key)
        const marker =
          markers.get(key) ??
          createMarker(
            key,
            feature.geometry.coordinates as [number, number],
            properties
          )
        marker
          .getElement()
          .classList.toggle(
            'is-active',
            properties.entry !== undefined && properties.entry === selectedEntry
          )
        if (!marker.getElement().isConnected) marker.addTo(map)
      }
    }
    for (const [key, marker] of markers)
      if (!visible.has(key)) {
        marker.remove()
        markers.delete(key)
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
    map.addSource(SOURCES.points, {
      type: 'geojson',
      data: pointFeatures(),
      cluster: true,
      clusterRadius: 48,
      clusterMaxZoom: 14,
      clusterProperties: {
        // 聚合用第一张照片当封面，颜色取最新的年份。
        photo: [
          ['coalesce', ['accumulated'], ['get', 'photo']],
          ['get', 'photo'],
        ],
        year: ['max', ['get', 'year']],
      },
    })
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
    // 不可见的占位层：让聚合源随视野加载，`querySourceFeatures` 才有数据。
    map.addLayer({
      id: LAYERS.points,
      type: 'circle',
      source: SOURCES.points,
      paint: { 'circle-radius': 0, 'circle-opacity': 0 },
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
    syncMarkers()
  }

  /**
   * 框住一组坐标时用的倾斜角。打开 3D 时先按平视算出落点缩放，再取该缩放的倾斜角，
   * 取景时就把落定后的倾斜算进去，近处的点不会被裁出画面。
   */
  function framingPitch(
    bounds: LngLatBoundsLike,
    padding: PaddingOptions,
    maxZoom?: number
  ) {
    if (!tilt) return 0
    const flat = map.cameraForBounds(bounds, { padding, maxZoom, pitch: 0 })
    return pitchAtZoom(flat?.zoom ?? map.getZoom())
  }

  /** 框住一组坐标的镜头（含 3D 下的倾斜），只计算不移动。 */
  function cameraFor(
    points: [number, number][],
    padding: PaddingOptions,
    maxZoom?: number
  ) {
    const bounds = boundsOf(points)
    if (!bounds) return undefined
    return map.cameraForBounds(bounds, {
      padding,
      maxZoom,
      pitch: framingPitch(bounds, padding, maxZoom),
    })
  }

  function fit(points: [number, number][], maxZoom: number) {
    const bounds = boundsOf(points)
    if (!bounds) return
    const padding = getPadding()
    map.fitBounds(bounds, {
      padding,
      maxZoom,
      pitch: framingPitch(bounds, padding, maxZoom),
      duration: reducedMotion() ? 0 : 900,
    })
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
    applyState()
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
    syncMarkers()
  })
  map.on('render', syncMarkers)

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
      selectedEntry = id && entries.has(id) ? id : undefined
      popup.remove()
      applyState()
      const entry = selectedEntry ? entries.get(selectedEntry) : undefined
      if (entry)
        map.easeTo({
          center: entry.coordinates,
          zoom: Math.max(map.getZoom(), 15),
          padding: getPadding(),
          duration: reducedMotion() ? 0 : 900,
        })
    },
    /** 只看某一年，`undefined` 为全部年份。 */
    setYear(next: number | undefined) {
      if (year === next) return
      year = next
      ;(map.getSource(SOURCES.points) as GeoJSONSource | undefined)?.setData(
        pointFeatures()
      )
      applyState()
      if (!selected && !selectedEntry) fit(pointsOf(year), 10)
    },
    /** 选中旅程里聚焦某一天：其它天的路线变淡、站点隐藏，镜头框住这一天。 */
    focusDay(day: number | undefined) {
      if (focusedDay === day || !selected) return
      focusedDay = day
      applyState()
      const trip = byId.get(selected)!
      const points = tripPoints(trip, day)
      if (points.length > 0) fit(points, 15)
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
      if (!map.getLayer(LAYERS.routes)) return
      for (const id of Object.values(LAYERS))
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
      if (visible) applyState()
      else syncMarkers()
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
      popup.remove()
      for (const marker of markers.values()) marker.remove()
      markers.clear()
      map.remove()
    },
  }
}

export type TripMap = Awaited<ReturnType<typeof createTripMap>>
