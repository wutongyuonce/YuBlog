/**
 * 旅行页的地图（MapLibre GL + OpenFreeMap 底图）：全部路线与聚合停靠点、
 * 选中旅程的序号点、悬停提示，以及按设置应用底图风格和 3D 视角。
 * 只管地图；面板、地址片段和回放由页面脚本与 `trip-replay.ts` 调度。
 */
import type {
  ExpressionSpecification,
  GeoJSONSource,
  LngLatBoundsLike,
  Map as MaplibreMap,
  MapMouseEvent,
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

export interface TripStopGeo {
  name: string
  coordinates: [number, number]
  index: number
}

export interface TripLegGeo {
  from: number
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

export interface TripMapOptions {
  container: HTMLElement
  trips: TripGeo[]
  /** 站点是否为深色主题。 */
  dark: boolean
  settings: MapSettings
  /** 地图四周被面板等遮住的部分，取景时让开。 */
  getPadding: () => PaddingOptions
  onSelectTrip: (id: string) => void
  onSelectStop: (index: number) => void
  onError: (message: string) => void
}

const SOURCES = {
  routes: 'trips-routes',
  stops: 'trips-stops',
  selected: 'trips-selected',
} as const
const LAYERS = {
  routes: 'trips-routes',
  clusters: 'trips-clusters',
  clusterCount: 'trips-cluster-count',
  stops: 'trips-stops',
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

export async function createTripMap(options: TripMapOptions) {
  const { container, trips, getPadding } = options
  const maplibregl = await import('maplibre-gl')
  maplibregl.setWorkerUrl(workerUrl)
  const byId = new Map(trips.map((trip) => [trip.id, trip]))
  const allPoints = trips.flatMap((trip) =>
    trip.stops.map((stop) => stop.coordinates)
  )
  const yearColors: ExpressionSpecification = [
    'match',
    ['get', 'year'],
    ...[...new Map(trips.map((trip) => [trip.year, trip.color]))].flat(),
    '#888888',
  ] as unknown as ExpressionSpecification

  let selected: string | undefined
  let lifted: string | undefined
  let activeStop: number | undefined
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
    offset: 12,
    className: 'trips-popup',
  })

  function routeFeatures() {
    return {
      type: 'FeatureCollection' as const,
      features: trips.flatMap((trip) =>
        trip.legs.map((leg) => ({
          type: 'Feature' as const,
          properties: { trip: trip.id, color: trip.color },
          geometry: { type: 'LineString' as const, coordinates: leg.path },
        }))
      ),
    }
  }

  function stopFeatures() {
    return {
      type: 'FeatureCollection' as const,
      features: trips.flatMap((trip) =>
        trip.stops.map((stop) => ({
          type: 'Feature' as const,
          properties: { trip: trip.id, color: trip.color, year: trip.year },
          geometry: { type: 'Point' as const, coordinates: stop.coordinates },
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
          number: String(stop.index + 1),
          name: stop.name,
          color: trip.color,
        },
        geometry: { type: 'Point' as const, coordinates: stop.coordinates },
      })),
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
    map.addSource(SOURCES.stops, {
      type: 'geojson',
      data: stopFeatures(),
      cluster: true,
      clusterRadius: 42,
      clusterMaxZoom: 11,
      clusterProperties: { year: ['max', ['get', 'year']] },
    })
    map.addSource(SOURCES.selected, {
      type: 'geojson',
      data: selectedFeatures(),
    })

    map.addLayer({
      id: LAYERS.routes,
      type: 'line',
      source: SOURCES.routes,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2, 12, 4],
      },
    })
    map.addLayer({
      id: LAYERS.clusters,
      type: 'circle',
      source: SOURCES.stops,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': yearColors,
        'circle-radius': ['step', ['get', 'point_count'], 13, 10, 16, 40, 20],
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2,
      },
    })
    map.addLayer({
      id: LAYERS.clusterCount,
      type: 'symbol',
      source: SOURCES.stops,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': FONT,
        'text-size': 12,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#fff' },
    })
    map.addLayer({
      id: LAYERS.stops,
      type: 'circle',
      source: SOURCES.stops,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': 6,
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2,
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

  /** 选中、悬停与当前站决定各图层的可见度和强调。 */
  function applyState() {
    if (!map.getLayer(LAYERS.routes)) return
    const focus = selected ?? lifted
    map.setPaintProperty(
      LAYERS.routes,
      'line-opacity',
      focus ? ['case', ['==', ['get', 'trip'], focus], 1, 0.15] : 0.8
    )
    const overview = selected ? 'none' : 'visible'
    for (const id of [LAYERS.clusters, LAYERS.clusterCount, LAYERS.stops])
      map.setLayoutProperty(id, 'visibility', overview)
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
  }

  /**
   * MapLibre 6 合并选项时会用 `maxZoom: undefined` 覆盖默认的 transform.maxZoom，
   * 随后 `Math.min(zoom, undefined)` 得到 NaN，镜头中心变成 Invalid LngLat。
   * 未指定或非有限值时不写入该项，让地图沿用自身上限。
   */
  function boundsCameraOptions(
    padding: PaddingOptions,
    maxZoom?: number,
    pitch?: number
  ) {
    return {
      padding,
      ...(pitch === undefined ? {} : { pitch }),
      ...(Number.isFinite(maxZoom) ? { maxZoom } : {}),
    }
  }

  function tryCameraForBounds(
    bounds: LngLatBoundsLike,
    options: ReturnType<typeof boundsCameraOptions>
  ) {
    try {
      return map.cameraForBounds(bounds, options)
    } catch {
      return undefined
    }
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
    const flat = tryCameraForBounds(
      bounds,
      boundsCameraOptions(padding, maxZoom, 0)
    )
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
    return tryCameraForBounds(
      bounds,
      boundsCameraOptions(
        padding,
        maxZoom,
        framingPitch(bounds, padding, maxZoom)
      )
    )
  }

  function fit(points: [number, number][], maxZoom: number) {
    const bounds = boundsOf(points)
    if (!bounds) return
    const padding = getPadding()
    map.fitBounds(bounds, {
      padding,
      maxZoom,
      pitch: framingPitch(bounds, padding, maxZoom),
      duration: matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 0
        : 900,
    })
  }

  function showPopup(event: MapMouseEvent, html: string) {
    popup.setLngLat(event.lngLat).setHTML(html).addTo(map)
  }

  const escape = (text: string) =>
    text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`)

  // 构造时按平视取景；首次加载后按 3D 的倾斜重新框住总览，边缘的点不被裁掉。
  map.once('style.load', () => {
    const camera = cameraFor(allPoints, getPadding(), 10)
    if (camera) map.jumpTo(camera)
  })
  map.on('style.load', () => {
    addLayers()
    applyTilt()
    ready = true
  })

  map.on('click', LAYERS.clusters, (event) => {
    const feature = event.features?.[0]
    const source = map.getSource(SOURCES.stops) as GeoJSONSource
    const clusterId = feature?.properties?.cluster_id
    if (clusterId === undefined || feature?.geometry.type !== 'Point') return
    const center = feature.geometry.coordinates as [number, number]
    source
      .getClusterExpansionZoom(clusterId)
      .then((zoom) => map.easeTo({ center, zoom }))
      .catch(() => undefined)
  })
  map.on(
    'mouseenter',
    LAYERS.clusters,
    () => (map.getCanvas().style.cursor = 'pointer')
  )
  map.on(
    'mouseleave',
    LAYERS.clusters,
    () => (map.getCanvas().style.cursor = '')
  )
  for (const layer of [LAYERS.routes, LAYERS.stops]) {
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
    cameraFor,
    /** 打开某段旅程或回到总览。 */
    select(id: string | undefined) {
      selected = id && byId.has(id) ? id : undefined
      activeStop = undefined
      popup.remove()
      applyState()
      const trip = selected ? byId.get(selected) : undefined
      if (trip)
        fit(
          trip.legs
            .flatMap((leg) => leg.path)
            .concat(trip.stops.map((s) => s.coordinates)),
          14
        )
      else fit(allPoints, 10)
    },
    /** 列表悬停时强调路线，不移动镜头。 */
    lift(id: string | undefined) {
      if (lifted === id) return
      lifted = id
      applyState()
    },
    /** 强调某站；`fly` 时把它移到视野中央。 */
    activateStop(index: number | undefined, fly = false) {
      activeStop = index
      applyState()
      const trip = selected ? byId.get(selected) : undefined
      const stop = index === undefined ? undefined : trip?.stops[index]
      if (stop && fly)
        map.easeTo({
          center: stop.coordinates,
          zoom: Math.max(map.getZoom(), 14),
          padding: getPadding(),
          duration: matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 0
            : 700,
        })
    },
    /** 只隐藏或恢复总览与选中图层，回放画自己的线。 */
    setBaseLayersVisible(visible: boolean) {
      if (!map.getLayer(LAYERS.routes)) return
      for (const id of Object.values(LAYERS))
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
      if (visible) applyState()
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
      map.remove()
    },
  }
}

export type TripMap = Awaited<ReturnType<typeof createTripMap>>
