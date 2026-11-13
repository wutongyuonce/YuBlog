/**
 * 圆周旅迹适配器：唯一了解其接口形状、坐标系和交通方式编码的模块。
 * 只做纯转换，不发请求、不读写文件；网络与落盘在 `scripts/import-trip.mjs`。
 * 产出的草稿只含行程内容，不带圆周的行程 ID、链接或用户资料。
 *
 * 接口有两个：`journey/detail` 给出行程，`web/route` 给出相邻两站之间的路线
 * （距离、时长、GCJ-02 路径，公共交通另有线路明细）。先用 `legRequests` 从行程
 * 算出要问的路段，再把两份响应一起交给 `toTripDraft`。
 *
 * 遇到对不上的形状时不静默降级，而是记进 `issues`：
 * - `source`：圆周出现了适配器没覆盖的取值（新的事件类型、交通编码、坐标系），要改本文件；
 * - `schema`：圆周的数据本站 schema 表达不了（如视频），要扩展 schema 或接受取舍；
 * - `data`：个别条目缺数据被跳过或降级，不需要改代码。
 * 前两类是错误，导入会停下；`data` 只是警告。
 */
import { CLOCK_TIME, SCHEDULED_MODES } from './trips.js'

const DETAIL_URL =
  'https://www.pitravel.cn/api/slytherin/v1/web/journey/detail?journey_id='
export const ROUTE_URL = 'https://www.pitravel.cn/api/slytherin/v1/web/route'
const DEFAULT_TIME_ZONE = 'Asia/Shanghai'
/**
 * `route_transportation_type`（去往下一站）→ 站内交通方式。
 * 0–3 是圆周网页可选的四种；5 是打车（路线与驾车相同）。缺省时圆周网页按步行。
 */
const TRAVEL_MODES = {
  0: 'drive',
  1: 'walk',
  2: 'bike',
  3: 'transit',
  5: 'taxi',
}
const DEFAULT_TRAVEL_CODE = 1
/** 站内方式 → 向 `web/route` 请求时用的编码；班次方式不请求。 */
const ROUTE_CODES = { drive: 0, walk: 1, bike: 2, transit: 3, taxi: 5 }
/** 交通事件的类型范围；200 未细分，按班次号推断。 */
const TRANSPORT_TYPES = { min: 200, max: 208 }
const TRANSPORT_MODES = {
  201: 'flight',
  202: 'train',
  203: 'ferry',
  204: 'drive',
  205: 'walk',
  206: 'bike',
  207: 'transit',
  208: 'transit',
}
const MODE_EMOJI = {
  flight: '✈️',
  train: '🚄',
  ferry: '⛴️',
  taxi: '🚕',
  drive: '🚗',
  walk: '🚶',
  bike: '🚲',
  transit: '🚌',
}
/** 铁路车次：字母前缀或纯数字；航班号都带航司代码。 */
const TRAIN_NUMBER = /^([GDCZTKSY]\d{1,4}|\d{1,4})$/i
const COORDINATE_TYPES = new Set(['GCJ02', 'WGS84'])
/** 图片条目里出现这些字段说明带了视频或实况，本站只存静态图。 */
const MOTION_FIELD = /video|live/i

/**
 * 从分享链接或纯数字取出行程 ID。
 * @param {string} input
 * @returns {string}
 */
export function parseJourneyId(input) {
  const text = String(input ?? '').trim()
  if (/^\d{6,}$/.test(text)) return text
  const match = /\/plan\/journey\/(\d{6,})(?:[/?#]|$)/.exec(text)
  if (!match) throw new Error(`无法从「${text}」识别圆周旅迹行程 ID。`)
  return match[1]
}

/** @param {string} journeyId */
export function journeyDetailUrl(journeyId) {
  return `${DETAIL_URL}${journeyId}`
}

const A = 6378245
const EE = 0.006693421622965943

function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(x, y) {
  let r =
    -100 +
    2 * x +
    3 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x))
  r +=
    ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3
  r += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3
  r +=
    ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) *
      2) /
    3
  return r
}

function transformLng(x, y) {
  let r =
    300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  r +=
    ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3
  r += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3
  r +=
    ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) *
      2) /
    3
  return r
}

/**
 * WGS84 → GCJ-02（中国境外原样返回）。
 * @param {number} lng
 * @param {number} lat
 * @returns {[number, number]}
 */
export function wgs84ToGcj02(lng, lat) {
  if (outOfChina(lng, lat)) return [lng, lat]
  const radLat = (lat / 180) * Math.PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  const dLat =
    (transformLat(lng - 105, lat - 35) * 180) /
    (((A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI)
  const dLng =
    (transformLng(lng - 105, lat - 35) * 180) /
    ((A / sqrtMagic) * Math.cos(radLat) * Math.PI)
  return [lng + dLng, lat + dLat]
}

/**
 * GCJ-02 → WGS84。迭代求逆，误差在厘米级；中国境外原样返回。
 * @param {number} lng
 * @param {number} lat
 * @returns {[number, number]}
 */
export function gcj02ToWgs84(lng, lat) {
  if (outOfChina(lng, lat)) return [lng, lat]
  let wgsLng = lng
  let wgsLat = lat
  for (let i = 0; i < 5; i++) {
    const [gLng, gLat] = wgs84ToGcj02(wgsLng, wgsLat)
    wgsLng -= gLng - lng
    wgsLat -= gLat - lat
  }
  return [wgsLng, wgsLat]
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function clock(value) {
  return typeof value === 'string' && CLOCK_TIME.test(value) ? value : undefined
}

function dateIn(timeZone, timestamp) {
  // en-CA 输出 YYYY-MM-DD。
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp))
}

/** 去掉圆周图片地址上的缩放参数，取原图。 */
function originalImage(url) {
  const value = text(url)
  if (!value || !/^https:\/\//.test(value)) return undefined
  return value.split('?')[0]
}

function eventType(event) {
  return Number(event.event_type_v2 ?? event.event_type)
}

/**
 * 一次读取的上下文：收集问题，标出位置。
 * @typedef {{ kind: 'source' | 'schema' | 'data', message: string }} Issue
 */
function createReader() {
  /** @type {Issue[]} */
  const issues = []
  const seen = new Set()
  return {
    issues,
    /** 同一种问题只报一次，后面的位置合并进第一条。 */
    report(kind, message, key = message) {
      if (seen.has(key)) return
      seen.add(key)
      issues.push({ kind, message })
    },
  }
}

function toCoordinates(poi, reader, where) {
  const lng = Number(poi?.location?.longitude)
  const lat = Number(poi?.location?.latitude)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return undefined
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return undefined
  const type = poi.coordinate_type
  if (type !== undefined && !COORDINATE_TYPES.has(type))
    reader.report(
      'source',
      `${where}：坐标系「${type}」未适配（已知 GCJ02、WGS84）。`,
      `coordinate:${type}`
    )
  return type === 'WGS84' ? [lng, lat] : gcj02ToWgs84(lng, lat)
}

function photoUrls(event, reader, where) {
  const list = Array.isArray(event.image_list) ? event.image_list : []
  if (
    list.some((image) =>
      Object.entries(image ?? {}).some(
        ([key, value]) => MOTION_FIELD.test(key) && Boolean(value)
      )
    )
  )
    reader.report(
      'schema',
      `${where}：带视频或实况素材，本站旅程只保存静态图片。`,
      `motion:${where}`
    )
  return list.map((image) => originalImage(image?.image_url)).filter(Boolean)
}

/** 去往下一站的方式编码；等知道是不是最后一站后再由 `resolveTravel` 解释。 */
function pendingTravel(event, where) {
  return { code: event.route_transportation_type ?? DEFAULT_TRAVEL_CODE, where }
}

/**
 * 给每站定下去往下一站的方式和路段请求。最后一站没有下一站，它的编码不读；
 * 其余站遇到未知编码记为 source 问题，按驾车继续转换以便一次报出全部问题。
 */
function resolveTravel(flat, reader) {
  flat.forEach((stop, index) => {
    const pending = stop.pending
    delete stop.pending
    if (index === flat.length - 1) {
      delete stop.travel
      delete stop.travelSeconds
      delete stop.service
      delete stop.leg
      return
    }
    if (!pending) return
    let mode = TRAVEL_MODES[pending.code]
    if (!mode) {
      reader.report(
        'source',
        `${pending.where}：交通方式编码 route_transportation_type=${pending.code} 未适配（已知 0 驾车、1 步行、2 骑行、3 公共交通、5 打车）。`,
        `travel:${pending.code}`
      )
      mode = 'drive'
    }
    stop.travel = mode
    stop.leg = { origin: stop.leg?.origin, code: ROUTE_CODES[mode] }
  })
}

function placeStop(event, reader, where) {
  const poi = event.start_poi_info ?? event.end_poi_info
  const coordinates = toCoordinates(poi, reader, where)
  const name = text(event.name) ?? text(poi?.name)
  if (!coordinates || !name) return []
  const category = Array.isArray(poi?.category) ? poi.category[0] : undefined
  const start = clock(event.start_time)
  const end = clock(event.end_time)
  const id = text(poi?.inner_poi_id)
  return [
    {
      name,
      category: text(category?.display_name),
      emoji: text(category?.icon),
      address: text(poi?.address),
      coordinates,
      time: start || end ? { start, end } : undefined,
      note: text(event.note),
      photoUrls: photoUrls(event, reader, where),
      placeImageUrl: originalImage(poi?.image),
      pending: pendingTravel(event, where),
      leg: { origin: id },
      arrival: id,
    },
  ]
}

/**
 * 交通事件拆成出发与到达两站，两站之间的方式由事件类型定。飞机、火车、船带班次
 * （班次号与起止时刻），时长取班次起止时间戳；站点自己的时间与班次时刻相同时不重复写。
 * 到达站之后按事件自己的交通方式去下一站。
 */
function transportStops(event, reader, where) {
  const from = event.start_poi_info
  const to = event.end_poi_info
  const fromAt = toCoordinates(from, reader, where)
  const toAt = toCoordinates(to, reader, where)
  // 只有一端可用时按普通地点导入，不丢整条事件。
  const fromOk = Boolean(fromAt && text(from?.name))
  const toOk = Boolean(toAt && text(to?.name))
  if (!fromOk || !toOk) {
    if (fromOk || toOk)
      reader.report(
        'data',
        `${where}：交通安排只有一端地点，按普通地点导入。`,
        `oneEnd:${where}`
      )
    return placeStop(
      {
        ...event,
        start_poi_info: fromOk ? from : toOk ? to : fromAt ? from : to,
      },
      reader,
      where
    )
  }
  const info = event.transport_info ?? {}
  const number = text(info.transport_num)
  const mode =
    TRANSPORT_MODES[eventType(event)] ??
    (number ? (TRAIN_NUMBER.test(number) ? 'train' : 'flight') : 'transit')
  // 起止时间都是有效时间戳时才算时长。
  const departs = Number(info.transport_start_time)
  const arrives = Number(info.transport_end_time)
  const seconds =
    departs > 0 && arrives > departs ? (arrives - departs) / 1000 : 0
  const start = clock(event.start_time)
  const end = clock(event.end_time)
  const scheduled = SCHEDULED_MODES.has(mode)
  const service = scheduled
    ? {
        number,
        depart: clock(info.depart_time) ?? start,
        arrive: clock(info.arrive_time) ?? end,
      }
    : undefined
  const hasService =
    service && (service.number || service.depart || service.arrive)
  const departTime = start && start !== service?.depart ? start : undefined
  const arriveTime = end && end !== service?.arrive ? end : undefined
  const common = { category: '交通', emoji: MODE_EMOJI[mode] }
  const fromId = text(from.inner_poi_id)
  const toId = text(to.inner_poi_id)
  return [
    {
      ...common,
      name: text(from.name),
      address: text(from.address),
      coordinates: fromAt,
      time: departTime ? { start: departTime } : undefined,
      note: text(event.note),
      photoUrls: photoUrls(event, reader, where),
      placeImageUrl: undefined,
      travel: mode,
      travelSeconds: seconds > 0 ? Math.round(seconds) : undefined,
      service: hasService ? service : undefined,
      // 路网方式的交通事件（驾车、步行等）也向圆周要路线；班次方式按直线。
      leg: scheduled
        ? undefined
        : { origin: fromId, destination: toId, code: ROUTE_CODES[mode] },
      arrival: fromId,
    },
    {
      ...common,
      name: text(to.name),
      address: text(to.address),
      coordinates: toAt,
      time: arriveTime ? { end: arriveTime } : undefined,
      note: undefined,
      photoUrls: [],
      placeImageUrl: undefined,
      pending: pendingTravel(event, where),
      leg: { origin: toId },
      arrival: toId,
    },
  ]
}

function toStops(event, reader, where) {
  const type = eventType(event)
  if (type >= TRANSPORT_TYPES.min && type <= TRANSPORT_TYPES.max)
    return transportStops(event, reader, where)
  // 2xx 是交通事件族；超出已知范围说明圆周新增了交通类型。
  if (type > TRANSPORT_TYPES.max && type < 300)
    reader.report(
      'source',
      `${where}：交通事件类型 ${type} 未适配（已知 200–208），暂按普通地点导入。`,
      `event:${type}`
    )
  return placeStop(event, reader, where)
}

/** 读出行程：日期、停靠点与各站去往下一站的路段请求（内部字段 `leg`、`arrival`）。 */
function readJourney(response) {
  if (!response || typeof response !== 'object')
    throw new Error('圆周旅迹返回了无法识别的数据。')
  if (response.code !== 0 || !response.data?.journey)
    throw new Error(
      `圆周旅迹拒绝了请求：${text(response.msg) ?? '未知错误'}（行程可能不存在或未公开）。`
    )
  const journey = response.data.journey
  const title = text(journey.name) ?? text(journey.remark)
  if (!title) throw new Error('行程没有名称。')
  const reader = createReader()
  let timeZone = DEFAULT_TIME_ZONE
  if (journey.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: journey.timezone })
      timeZone = journey.timezone
    } catch {
      reader.report(
        'data',
        `行程时区「${journey.timezone}」无效，按 ${DEFAULT_TIME_ZONE} 计算日期。`
      )
    }
  }

  const days = []
  for (const day of (Array.isArray(journey.day_plans) ? journey.day_plans : [])
    .filter((day) => day?.day_index !== -1 && Number.isFinite(day?.timestamp))
    .toSorted((a, b) => a.timestamp - b.timestamp)) {
    const date = dateIn(timeZone, day.timestamp)
    const stops = (Array.isArray(day.events) ? day.events : []).flatMap(
      (event, index) => {
        const name = text(event?.name) ?? '（未命名）'
        const where = `${date} 第 ${index + 1} 项「${name}」`
        const stops = event ? toStops(event, reader, where) : []
        if (stops.length === 0)
          reader.report('data', `${where} 缺少坐标或名称，未导入。`)
        return stops
      }
    )
    const previous = days.at(-1)
    // 两个日程落在同一天时合并，不丢地点。
    if (previous?.date === date) {
      previous.stops.push(...stops)
      previous.summary ??= text(day.remark)
    } else days.push({ date, summary: text(day.remark), stops })
  }
  if (days.length === 0) throw new Error('行程里没有已安排日期的日程。')
  resolveTravel(
    days.flatMap((day) => day.stops),
    reader
  )

  const coverUrls = [
    originalImage(journey.cover),
    ...(Array.isArray(journey.image_list) ? journey.image_list : []).map(
      (image) => originalImage(image?.image_url)
    ),
  ].filter((url, index, all) => url && all.indexOf(url) === index)

  return { title, days, coverUrls, reader }
}

/** 每站去往下一站要请求的路段；同一地点或缺 ID 时没有。 */
function legsOf(days) {
  const flat = days.flatMap((day) => day.stops)
  return flat.map((stop, index) => {
    const next = flat[index + 1]
    const leg = stop.leg
    if (!next || !leg || leg.code === undefined) return undefined
    const origin = leg.origin
    const destination = leg.destination ?? next.arrival
    if (!origin || !destination || origin === destination) return undefined
    return {
      originPoiId: origin,
      destinationPoiId: destination,
      travelType: leg.code,
    }
  })
}

const legKey = (leg) =>
  `${leg.originPoiId}|${leg.destinationPoiId}|${leg.travelType}`

/**
 * 要向 `web/route` 请求的路段（去重）。
 * @param {unknown} response `journey/detail` 的完整 JSON
 * @returns {{ originPoiId: string, destinationPoiId: string, travelType: number }[]}
 */
export function legRequests(response) {
  const unique = new Map()
  for (const leg of legsOf(readJourney(response).days))
    if (leg) unique.set(legKey(leg), leg)
  return [...unique.values()]
}

/** `web/route` 的请求体。 */
export function routeRequestBody(requests) {
  return { routeRequest: requests, realTime: 1 }
}

/** 圆周的 `"lng,lat;lng,lat"` 分段路径 → WGS84 坐标。 */
function routePath(paths) {
  const points = []
  for (const segment of Array.isArray(paths) ? paths : []) {
    for (const pair of String(segment).split(';')) {
      const [lng, lat] = pair.split(',').map(Number)
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
      const point = gcj02ToWgs84(lng, lat)
      const last = points.at(-1)
      if (!last || last[0] !== point[0] || last[1] !== point[1])
        points.push(point)
    }
  }
  return points
}

/** 公共交通的乘坐明细：去掉步行段，保留线路、起止站和经停数。 */
function transitOf(info) {
  const lines = (Array.isArray(info?.steps) ? info.steps : [])
    .filter((step) => Number(step?.type) !== 0 && text(step?.name))
    .map((step) => {
      const stops = Number(step.via_num)
      return {
        name: text(step.name),
        from: text(step.origin),
        to: text(step.destination),
        stops: Number.isInteger(stops) && stops > 0 ? stops : undefined,
      }
    })
  if (lines.length === 0) return undefined
  return { fare: text(info.cost), lines }
}

/** `web/route` 响应 → 按路段索引的路线提示；没有距离或路径的条目不算。 */
function routeHints(routeResponse) {
  const hints = new Map()
  const list = routeResponse?.data?.routeData
  for (const item of Array.isArray(list) ? list : []) {
    const distance = Number(item?.distance)
    const path = routePath(item?.paths)
    if (!(distance > 0) || path.length < 2) continue
    const duration = Number(item.duration)
    hints.set(legKey(item), {
      distance: Math.round(distance),
      duration: duration > 0 ? Math.round(duration) : undefined,
      path,
      transit:
        Number(item.travelType) === ROUTE_CODES.transit
          ? transitOf(item.public_transit_info)
          : undefined,
    })
  }
  return hints
}

/**
 * 接口响应 → 中立草稿。图片仍是远程地址；路段带交通方式，圆周给了路线时
 * 附上 `routeHint`（WGS84 路径、距离、时长、公交明细），没给的由导入脚本另行规划。
 * @param {unknown} response `journey/detail` 的完整 JSON
 * @param {unknown} [routeResponse] `web/route` 的完整 JSON；省略时不附路线
 */
export function toTripDraft(response, routeResponse) {
  const { title, days, coverUrls, reader } = readJourney(response)
  const legs = legsOf(days)
  const hints =
    routeResponse === undefined ? undefined : routeHints(routeResponse)
  if (routeResponse !== undefined && routeResponse?.success !== true)
    reader.report(
      'data',
      `圆周路线接口没有成功返回（${text(routeResponse?.msg) ?? '未知原因'}），路线改由公共路线服务规划。`
    )
  const flat = days.flatMap((day) => day.stops)
  const draftDays = days.map((day) => ({
    date: day.date,
    summary: day.summary,
    stops: day.stops.map((stop) => {
      const { leg: _leg, arrival: _arrival, ...rest } = stop
      const index = flat.indexOf(stop)
      const request = legs[index]
      const routeHint = request && hints?.get(legKey(request))
      if (request && hints && !routeHint && routeResponse?.success === true)
        reader.report(
          'data',
          `「${stop.name} → ${flat[index + 1].name}」圆周没有返回路线，改由公共路线服务规划。`
        )
      return routeHint ? { ...rest, routeHint } : rest
    }),
  }))

  return {
    title,
    start: draftDays[0].date,
    end: draftDays.at(-1).date,
    coverUrls,
    days: draftDays,
    issues: reader.issues,
  }
}
