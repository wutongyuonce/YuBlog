/**
 * 旅行页的展示规则：状态、统计、配色、日期文案、拼图取图与地图载荷。
 * 构建期页面、`/trips/map.json` 和浏览器里的状态重算都从这里读，不另做推断。
 * 数据形状见 `tripSchema`（src/content/schema.ts）。
 */

const TRIP_TIME_ZONE = 'Asia/Shanghai'
export const STATUS_LABELS = { plan: '计划', record: '记录' }
export const ROUTE_MODE_LABELS = {
  drive: '驾车',
  walk: '步行',
  flight: '飞机',
  train: '火车',
  straight: '直线',
}
const COLLAGE_SIZE = 3
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
// 按年份取模，新增年份不会改变已有年份的颜色；相邻年份不撞色。
// 2024 蓝、2025 紫、2026 琥珀，之后依次青、绿、粉。
const YEAR_PALETTE = [
  '#10b981',
  '#ec4899',
  '#3b82f6',
  '#8b5cf6',
  '#f59e0b',
  '#06b6d4',
]

/**
 * 上海时区的当天，`YYYY-MM-DD`。
 * @param {Date} [now]
 */
export function todayInTripZone(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TRIP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * 结束日已过为记录，否则为计划。
 * @param {string} end `YYYY-MM-DD`
 * @param {string} today `YYYY-MM-DD`
 * @returns {'plan' | 'record'}
 */
export function tripStatus(end, today) {
  return today > end ? 'record' : 'plan'
}

function parseDate(date) {
  const [year, month, day] = date.split('-').map(Number)
  return { year, month, day, time: Date.UTC(year, month - 1, day) }
}

/** 首尾日期（含）之间的天数。 */
export function tripDayCount(trip) {
  return (
    (parseDate(trip.end).time - parseDate(trip.start).time) / 86_400_000 + 1
  )
}

function stops(trip) {
  return trip.days.flatMap((day) => day.stops)
}

/** 去重后的地点数：同名地点重复到访只算一次。 */
export function tripPlaceCount(trip) {
  return new Set(stops(trip).map((stop) => stop.name)).size
}

/** 全程路线长度（米），含直线段。 */
export function tripDistance(trip) {
  return stops(trip).reduce((sum, stop) => sum + (stop.route?.distance ?? 0), 0)
}

/** 面板顶部的合计。 */
export function tripTotals(trips) {
  return {
    count: trips.length,
    days: trips.reduce((sum, trip) => sum + tripDayCount(trip), 0),
    places: trips.reduce((sum, trip) => sum + tripPlaceCount(trip), 0),
    distance: trips.reduce((sum, trip) => sum + tripDistance(trip), 0),
  }
}

/**
 * 公里数文案（不含单位）：不足 10 公里保留一位小数。
 * @param {number} meters
 */
export function formatKilometers(meters) {
  const km = meters / 1000
  if (km < 10) return String(Math.round(km * 10) / 10)
  return Math.round(km).toLocaleString('zh-CN')
}

/**
 * 路段耗时文案，如「11 分钟」「1 小时 5 分钟」。
 * @param {number} seconds
 */
export function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} 分钟`
  const rest = minutes % 60
  return `${Math.floor(minutes / 60)} 小时${rest ? ` ${rest} 分钟` : ''}`
}

/**
 * 停靠点时间：两端都有写成「09:00 – 11:00」，只有一端时标明是起还是止，
 * 避免跨夜航班的「22:00」与「00:25」看起来顺序颠倒。
 * @param {{ start?: string, end?: string } | undefined} time
 */
export function formatStopTime(time) {
  if (time?.start && time.end) return `${time.start} – ${time.end}`
  if (time?.start) return `${time.start} 起`
  if (time?.end) return `至 ${time.end}`
  return ''
}

function monthDay({ month, day }) {
  return `${month}月${day}日`
}

/**
 * 日期范围；跨年时两端带年份。
 * @param {string} start
 * @param {string} end
 */
export function formatDateRange(start, end) {
  const from = parseDate(start)
  const to = parseDate(end)
  if (start === end) return monthDay(from)
  if (from.year !== to.year)
    return `${from.year}年${monthDay(from)} – ${to.year}年${monthDay(to)}`
  return `${monthDay(from)} – ${monthDay(to)}`
}

/** 详情里的日标题，如「11月6日 周五」。 */
export function formatDayLabel(date) {
  const parsed = parseDate(date)
  return `${monthDay(parsed)} ${WEEKDAYS[new Date(parsed.time).getUTCDay()]}`
}

/** `start` 所在年份。 */
export function tripYear(trip) {
  return parseDate(trip.start).year
}

/** @param {number} year */
export function yearColor(year) {
  return YEAR_PALETTE[
    ((year % YEAR_PALETTE.length) + YEAR_PALETTE.length) % YEAR_PALETTE.length
  ]
}

/**
 * 封面拼图：`cover` 候选在前，各站照片在后，去重后最多三张；
 * 空数组表示用文字占位。
 * @template T
 * @param {{ cover: T[], days: { stops: { photos: T[] }[] }[] }} trip
 * @param {(image: T) => string} key 判断同一张图
 * @returns {T[]}
 */
export function collageImages(trip, key) {
  const seen = new Set()
  const picked = []
  for (const image of [
    ...trip.cover,
    ...stops(trip).flatMap((stop) => stop.photos),
  ]) {
    const id = key(image)
    if (seen.has(id)) continue
    seen.add(id)
    picked.push(image)
    if (picked.length === COLLAGE_SIZE) break
  }
  return picked
}

/**
 * `/trips/map.json` 里一段旅程的几何：各站坐标与全程序号，及逐段路径。
 * @param {string} id
 * @param {{ title: string, start: string, end: string, days: { stops: { name: string, coordinates: [number, number], route?: { path: [number, number][] } }[] }[] }} trip
 */
export function tripMapData(id, trip) {
  const all = stops(trip)
  return {
    id,
    title: trip.title,
    dates: formatDateRange(trip.start, trip.end),
    color: yearColor(tripYear(trip)),
    year: tripYear(trip),
    stops: all.map((stop, index) => ({
      name: stop.name,
      coordinates: stop.coordinates,
      index,
    })),
    legs: all.flatMap((stop, index) =>
      stop.route ? [{ from: index, path: stop.route.path }] : []
    ),
  }
}
