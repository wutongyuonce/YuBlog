/**
 * 手写行程草稿 → 导入用的中立草稿（与 `pitravel.mjs` 的 `toTripDraft` 同形）。
 * 用于用户直接提供信息与素材、由 AI 整理时间线的情形；只做校验与转换，
 * 网络、图片和落盘在 `scripts/import-trip.mjs`。草稿格式见 docs/design/trips.md#导入。
 * 校验从严：未知字段、类型不对或会被忽略的取值都报错，在联网之前指出位置。
 */
import { isAbsolute, resolve } from 'node:path'

import { gcj02ToWgs84 } from './pitravel.mjs'
import {
  CLOCK_TIME,
  ROAD_MODES,
  ROUTE_MODES,
  SCHEDULED_MODES,
} from './trips.js'

const TRIP_KEYS = new Set(['title', 'coordinateSystem', 'cover', 'days'])
const DAY_KEYS = new Set(['date', 'summary', 'stops'])
const STOP_KEYS = new Set([
  'name',
  'coordinates',
  'category',
  'emoji',
  'address',
  'time',
  'note',
  'photos',
  'travel',
  'travelMinutes',
  'service',
  'transit',
])
const SERVICE_KEYS = new Set(['number', 'depart', 'arrive'])
const TRANSIT_KEYS = new Set(['fare', 'lines'])
const LINE_KEYS = new Set(['name', 'from', 'to', 'stops'])

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function knownKeys(value, keys, where) {
  for (const key of Object.keys(value))
    if (!keys.has(key)) throw new Error(`${where} 有未知字段「${key}」。`)
}

/** 可选文字：省略可以，写了就必须是非空字符串。 */
function optionalText(value, where) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${where} 必须是非空文字。`)
  return value.trim()
}

function isDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)
  )
}

/** 远程图片原样保留，本地路径按草稿文件所在目录解析。 */
function sources(list, baseDir, where) {
  if (list === undefined) return []
  if (!Array.isArray(list)) throw new Error(`${where} 必须是数组。`)
  return list.map((item, index) => {
    const path = optionalText(item, `${where}第 ${index + 1} 项`)
    if (!path) throw new Error(`${where}第 ${index + 1} 项不能为空。`)
    if (/^https?:\/\//.test(path)) return path
    return isAbsolute(path) ? path : resolve(baseDir, path)
  })
}

function clock(value, where) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !CLOCK_TIME.test(value))
    throw new Error(`${where} 必须是 HH:mm。`)
  return value
}

/** 飞机、火车、船的班次：班次号与起止时刻，至少写一项。 */
function toService(value, travel, at) {
  if (value === undefined) return undefined
  if (!SCHEDULED_MODES.has(travel))
    throw new Error(`${at} 的 service 只用于 flight／train／ferry。`)
  if (!isObject(value)) throw new Error(`${at} 的 service 必须是对象。`)
  knownKeys(value, SERVICE_KEYS, `${at} 的 service`)
  const service = {
    number: optionalText(value.number, `${at} 的 service.number`),
    depart: clock(value.depart, `${at} 的 service.depart`),
    arrive: clock(value.arrive, `${at} 的 service.arrive`),
  }
  if (!service.number && !service.depart && !service.arrive)
    throw new Error(`${at} 的 service 至少要有 number、depart 或 arrive。`)
  return service
}

/** 公共交通的乘坐明细：线路列表和可选票价。 */
function toTransit(value, travel, at) {
  if (value === undefined) return undefined
  if (travel !== 'transit')
    throw new Error(`${at} 的 transit 只用于 travel: transit。`)
  if (!isObject(value)) throw new Error(`${at} 的 transit 必须是对象。`)
  knownKeys(value, TRANSIT_KEYS, `${at} 的 transit`)
  if (!Array.isArray(value.lines) || value.lines.length === 0)
    throw new Error(`${at} 的 transit.lines 至少要有一条线路。`)
  return {
    fare: optionalText(value.fare, `${at} 的 transit.fare`),
    lines: value.lines.map((line, index) => {
      const where = `${at} 的 transit.lines 第 ${index + 1} 项`
      if (!isObject(line)) throw new Error(`${where} 必须是对象。`)
      knownKeys(line, LINE_KEYS, where)
      const name = optionalText(line.name, `${where} 的 name`)
      if (!name) throw new Error(`${where} 缺少 name。`)
      if (
        line.stops !== undefined &&
        !(Number.isInteger(line.stops) && line.stops > 0)
      )
        throw new Error(`${where} 的 stops 必须是正整数。`)
      return {
        name,
        from: optionalText(line.from, `${where} 的 from`),
        to: optionalText(line.to, `${where} 的 to`),
        stops: line.stops,
      }
    }),
  }
}

function toStop(stop, where, gcj02, baseDir) {
  if (!isObject(stop)) throw new Error(`${where} 必须是对象。`)
  const name = optionalText(stop.name, `${where} 的 name`)
  if (!name) throw new Error(`${where} 缺少 name。`)
  const at = `${where}「${name}」`
  knownKeys(stop, STOP_KEYS, at)
  const [lng, lat] = Array.isArray(stop.coordinates) ? stop.coordinates : []
  if (
    stop.coordinates?.length !== 2 ||
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    Math.abs(lng) > 180 ||
    Math.abs(lat) > 90
  )
    throw new Error(`${at} 的 coordinates 必须是 [经度, 纬度]。`)
  const travel = stop.travel === undefined ? 'drive' : stop.travel
  if (!ROUTE_MODES.includes(travel))
    throw new Error(`${at} 的 travel 只能是 ${ROUTE_MODES.join('／')}。`)
  const minutes = stop.travelMinutes
  if (minutes !== undefined) {
    // 路网方式的时长由路线服务给出。
    if (ROAD_MODES.has(travel))
      throw new Error(
        `${at} 的 travelMinutes 只用于 flight／train／ferry／transit。`
      )
    if (!(Number.isFinite(minutes) && minutes > 0))
      throw new Error(`${at} 的 travelMinutes 必须是正数。`)
  }
  if (
    stop.time !== undefined &&
    !(isObject(stop.time) && (stop.time.start || stop.time.end))
  )
    throw new Error(`${at} 的 time 必须是至少含 start 或 end 的对象。`)
  if (stop.time)
    knownKeys(stop.time, new Set(['start', 'end']), `${at} 的 time`)
  const start = clock(stop.time?.start, `${at} 的 time.start`)
  const end = clock(stop.time?.end, `${at} 的 time.end`)
  return {
    name,
    category: optionalText(stop.category, `${at} 的 category`),
    emoji: optionalText(stop.emoji, `${at} 的 emoji`),
    address: optionalText(stop.address, `${at} 的 address`),
    coordinates: gcj02 ? gcj02ToWgs84(lng, lat) : [lng, lat],
    time: start || end ? { start, end } : undefined,
    note: optionalText(stop.note, `${at} 的 note`),
    photoUrls: sources(stop.photos, baseDir, `${at} 的 photos `),
    placeImageUrl: undefined,
    travel,
    travelSeconds: minutes === undefined ? undefined : Math.round(minutes * 60),
    service: toService(stop.service, travel, at),
    transit: toTransit(stop.transit, travel, at),
  }
}

/**
 * 校验并转换草稿；有任何不合格的字段都抛错并指出位置。
 * @param {unknown} value 草稿 JSON
 * @param {string} baseDir 草稿文件所在目录，用于解析本地图片
 */
export function parseTripDraft(value, baseDir) {
  if (!isObject(value)) throw new Error('草稿不是对象。')
  knownKeys(value, TRIP_KEYS, '草稿')
  const title = optionalText(value.title, 'title')
  if (!title) throw new Error('草稿缺少 title。')
  if (!['wgs84', 'gcj02', undefined].includes(value.coordinateSystem))
    throw new Error('coordinateSystem 只能是 wgs84 或 gcj02。')
  const gcj02 = value.coordinateSystem === 'gcj02'
  if (!Array.isArray(value.days) || value.days.length === 0)
    throw new Error('草稿至少要有一天。')
  const days = value.days.map((day, index) => {
    const where = `第 ${index + 1} 天`
    if (!isObject(day)) throw new Error(`${where} 必须是对象。`)
    knownKeys(day, DAY_KEYS, where)
    if (!isDate(day.date))
      throw new Error(`${where} 的 date 必须是真实存在的 YYYY-MM-DD。`)
    if (index > 0 && day.date <= value.days[index - 1].date)
      throw new Error(`${where} 的 date 必须晚于前一天。`)
    const stops = day.stops === undefined ? [] : day.stops
    if (!Array.isArray(stops)) throw new Error(`${where} 的 stops 必须是数组。`)
    return {
      date: day.date,
      summary: optionalText(day.summary, `${where} 的 summary`),
      stops: stops.map((stop, stopIndex) =>
        toStop(stop, `${where}第 ${stopIndex + 1} 站`, gcj02, baseDir)
      ),
    }
  })
  // 最后一站没有下一站，写了交通字段也不会生效。
  const last = value.days.flatMap((day) => day.stops ?? []).at(-1)
  if (
    last &&
    ['travel', 'travelMinutes', 'service', 'transit'].some(
      (key) => last[key] !== undefined
    )
  )
    throw new Error(
      `最后一站「${last.name}」没有下一站，不要写 travel、travelMinutes、service 或 transit。`
    )

  return {
    title,
    start: days[0].date,
    end: days.at(-1).date,
    coverUrls: sources(value.cover, baseDir, 'cover '),
    days,
    issues: [],
  }
}
