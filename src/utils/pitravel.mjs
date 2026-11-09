/**
 * 圆周旅迹适配器：唯一了解其接口形状、坐标系和交通方式编码的模块。
 * 只做纯转换，不发请求、不读写文件；网络与落盘在 `scripts/import-trip.mjs`。
 * 产出的草稿只含行程内容，不带圆周的行程 ID、链接或用户资料。
 */
import { CLOCK_TIME } from './trips.js'

const DETAIL_URL =
  'https://www.pitravel.cn/api/slytherin/v1/web/journey/detail?journey_id='
const DEFAULT_TIME_ZONE = 'Asia/Shanghai'
/** `route_transportation_type`（去往下一站）→ 站内交通方式；未列出的编码按直线处理。 */
const TRAVEL_MODES = { 0: 'drive', 1: 'walk', 2: 'bike', 3: 'transit' }
/**
 * 事件类型优先取 `event_type_v2`。200–208 是交通事件，带出发与到达两个地点：
 * 201 飞机、202 火车、203 船、204 驾车、205 步行、206 骑行、207／208 公交；
 * 200 未细分，按班次号推断。
 */
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
  drive: '🚗',
  walk: '🚶',
  bike: '🚲',
  transit: '🚌',
}
/** 铁路车次：字母前缀或纯数字；航班号都带航司代码。 */
const TRAIN_NUMBER = /^([GDCZTKSY]\d{1,4}|\d{1,4})$/i

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

function validTimeZone(value) {
  if (typeof value !== 'string') return DEFAULT_TIME_ZONE
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return value
  } catch {
    return DEFAULT_TIME_ZONE
  }
}

/** 去掉圆周图片地址上的缩放参数，取原图。 */
function originalImage(url) {
  const value = text(url)
  if (!value || !/^https:\/\//.test(value)) return undefined
  return value.split('?')[0]
}

function toCoordinates(poi) {
  const lng = Number(poi?.location?.longitude)
  const lat = Number(poi?.location?.latitude)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return undefined
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return undefined
  return poi.coordinate_type === 'WGS84' ? [lng, lat] : gcj02ToWgs84(lng, lat)
}

function photoUrls(event) {
  return (Array.isArray(event.image_list) ? event.image_list : [])
    .map((image) => originalImage(image?.image_url))
    .filter(Boolean)
}

function placeStop(event) {
  const poi = event.start_poi_info ?? event.end_poi_info
  const coordinates = toCoordinates(poi)
  const name = text(event.name) ?? text(poi?.name)
  if (!coordinates || !name) return []
  const category = Array.isArray(poi?.category) ? poi.category[0] : undefined
  const start = clock(event.start_time)
  const end = clock(event.end_time)
  return [
    {
      name,
      category: text(category?.display_name),
      emoji: text(category?.icon),
      address: text(poi?.address),
      coordinates,
      time: start || end ? { start, end } : undefined,
      note: text(event.note),
      photoUrls: photoUrls(event),
      placeImageUrl: originalImage(poi?.image),
      travel: TRAVEL_MODES[event.route_transportation_type] ?? 'straight',
    },
  ]
}

/**
 * 交通事件拆成出发与到达两站：两站之间的方式由事件类型定，班次起止时间给出的时长
 * 只用于不走路网的方式；到达站之后按事件自己的交通方式去下一站。
 */
function transportStops(event) {
  const from = event.start_poi_info
  const to = event.end_poi_info
  const fromAt = toCoordinates(from)
  const toAt = toCoordinates(to)
  // 只有一端可用时按普通地点导入，不丢整条事件。
  const fromOk = Boolean(fromAt && text(from?.name))
  const toOk = Boolean(toAt && text(to?.name))
  if (!fromOk || !toOk)
    return placeStop({
      ...event,
      start_poi_info: fromOk ? from : toOk ? to : fromAt ? from : to,
    })
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
  const common = { category: '交通', emoji: MODE_EMOJI[mode] }
  const start = clock(event.start_time)
  const end = clock(event.end_time)
  return [
    {
      ...common,
      name: text(from.name),
      address: text(from.address),
      coordinates: fromAt,
      time: start ? { start } : undefined,
      note: [number, text(event.note)].filter(Boolean).join(' · ') || undefined,
      photoUrls: photoUrls(event),
      placeImageUrl: undefined,
      travel: mode,
      travelSeconds: seconds > 0 ? Math.round(seconds) : undefined,
    },
    {
      ...common,
      name: text(to.name),
      address: text(to.address),
      coordinates: toAt,
      time: end ? { end } : undefined,
      note: undefined,
      photoUrls: [],
      placeImageUrl: undefined,
      travel: TRAVEL_MODES[event.route_transportation_type] ?? 'straight',
    },
  ]
}

function eventType(event) {
  return Number(event.event_type_v2 ?? event.event_type)
}

function toStops(event) {
  const type = eventType(event)
  return type >= 200 && type <= 208 ? transportStops(event) : placeStop(event)
}

/**
 * 接口响应 → 中立草稿。图片仍是远程地址，路线只给出交通方式；
 * 跳过的停靠点在 `skipped` 里列出名字，由调用方提示。
 * @param {unknown} response `journey/detail` 的完整 JSON
 */
export function toTripDraft(response) {
  if (!response || typeof response !== 'object')
    throw new Error('圆周旅迹返回了无法识别的数据。')
  if (response.code !== 0 || !response.data?.journey)
    throw new Error(
      `圆周旅迹拒绝了请求：${text(response.msg) ?? '未知错误'}（行程可能不存在或未公开）。`
    )
  const journey = response.data.journey
  const title = text(journey.name) ?? text(journey.remark)
  if (!title) throw new Error('行程没有名称。')
  const timeZone = validTimeZone(journey.timezone)
  const skipped = []

  const days = []
  for (const day of (Array.isArray(journey.day_plans) ? journey.day_plans : [])
    .filter((day) => day?.day_index !== -1 && Number.isFinite(day?.timestamp))
    .toSorted((a, b) => a.timestamp - b.timestamp)) {
    const stops = (Array.isArray(day.events) ? day.events : []).flatMap(
      (event) => {
        const stops = event ? toStops(event) : []
        if (stops.length === 0) skipped.push(text(event?.name) ?? '（未命名）')
        return stops
      }
    )
    const date = dateIn(timeZone, day.timestamp)
    const previous = days.at(-1)
    // 两个日程落在同一天时合并，不丢地点。
    if (previous?.date === date) {
      previous.stops.push(...stops)
      previous.summary ??= text(day.remark)
    } else days.push({ date, summary: text(day.remark), stops })
  }
  if (days.length === 0) throw new Error('行程里没有已安排日期的日程。')

  const coverUrls = [
    originalImage(journey.cover),
    ...(Array.isArray(journey.image_list) ? journey.image_list : []).map(
      (image) => originalImage(image?.image_url)
    ),
  ].filter((url, index, all) => url && all.indexOf(url) === index)

  return {
    title,
    start: days[0].date,
    end: days.at(-1).date,
    coverUrls,
    days,
    skipped,
  }
}
