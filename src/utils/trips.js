/**
 * 旅行页的展示规则：状态、统计、配色、日期文案、拼图取图与地图载荷。
 * 构建期页面、`/trips/map.json` 和浏览器里的状态重算都从这里读，不另做推断。
 * 数据形状见 `tripSchema`（src/content/schema.ts）。
 */

import { haversine } from './geo.mjs'

const TRIP_TIME_ZONE = 'Asia/Shanghai'
/** 停靠点时刻 `HH:mm`；schema、圆周适配器和草稿校验共用。 */
export const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/
export const STATUS_LABELS = { plan: '计划', record: '记录' }
/** 两站之间的交通方式；schema、导入和页面共用这一份。 */
export const ROUTE_MODES = /** @type {const} */ ([
  'flight',
  'train',
  'ferry',
  'taxi',
  'drive',
  'walk',
  'bike',
  'transit',
])
export const ROUTE_MODE_LABELS = {
  flight: '飞机',
  train: '火车',
  ferry: '船',
  taxi: '打车',
  drive: '开车',
  walk: '步行',
  bike: '骑行',
  transit: '公共交通',
}
/** 各交通方式的图标（UnoCSS 类名，已列入 safelist）；详情和回放共用。 */
export const ROUTE_MODE_ICONS = {
  flight: 'i-ri-plane-line',
  train: 'i-ri-train-line',
  ferry: 'i-ri-ship-line',
  taxi: 'i-ri-taxi-line',
  drive: 'i-ri-car-line',
  walk: 'i-ri-walk-line',
  bike: 'i-ri-riding-line',
  transit: 'i-ri-bus-line',
}
/** 有班次的方式：可以写班次号和起止时刻，路径是两点直线。 */
export const SCHEDULED_MODES = new Set(['flight', 'train', 'ferry'])
/** 走路网的方式：可以向路线服务请求路径。 */
export const ROAD_MODES = new Set(['taxi', 'drive', 'walk', 'bike'])
/** 没有设置交通方式时按大圆距离推断：1.5 公里以内步行，更远开车。 */
const WALK_DISTANCE_METERS = 1500
export function defaultTravelMode(from, to) {
  return haversine(from, to) <= WALK_DISTANCE_METERS ? 'walk' : 'drive'
}
const COLLAGE_SIZE = 3
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
// 按年份从旧到新依次取色，相邻年份不撞色。
const YEAR_PALETTE = [
  '#f59e0b',
  '#3b82f6',
  '#ec4899',
  '#10b981',
  '#8b5cf6',
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

/**
 * 一天的里程（米）：从这一天的站出发的路段之和，跨天的路段算在出发那天。
 * @param {{ stops: { route?: { distance: number } }[] }} day
 */
export function dayDistance(day) {
  return day.stops.reduce((sum, stop) => sum + (stop.route?.distance ?? 0), 0)
}

/** 全程里程（米）：各天里程相加，含直线段。 */
export function tripDistance(trip) {
  return trip.days.reduce((sum, day) => sum + dayDistance(day), 0)
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
 * 两站之间那一行：图标和文字。班次写班次号与起止时刻，公共交通写线路与票价，
 * 其余写方式；都带里程，有时长时带时长，直线估算的里程标出来。
 * @param {{ mode: keyof typeof ROUTE_MODE_LABELS, distance: number, duration?: number, straight?: true,
 *   service?: { number?: string, depart?: string, arrive?: string },
 *   transit?: { fare?: string, lines: { name: string }[] } }} route
 */
export function routeSummary(route) {
  const { service, transit } = route
  const head = service?.number ?? ROUTE_MODE_LABELS[route.mode]
  const times =
    service?.depart && service.arrive
      ? `${service.depart}–${service.arrive}`
      : formatStopTime({ start: service?.depart, end: service?.arrive })
  const parts = [
    transit ? transit.lines.map((line) => line.name).join(' → ') : head,
    times,
    transit?.fare,
    // 班次两端时刻齐全时不再重复时长。
    route.duration !== undefined && !(service?.depart && service.arrive)
      ? formatDuration(route.duration)
      : '',
    `${route.straight ? '直线约 ' : ''}${formatKilometers(route.distance)} 公里`,
  ]
  return {
    icon: ROUTE_MODE_ICONS[route.mode],
    label: ROUTE_MODE_LABELS[route.mode],
    text: parts.filter(Boolean).join(' · '),
  }
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

/**
 * 用地点名搜小红书的链接。只是搜索入口，不保证结果就是这个地点。
 * @param {string} name
 */
export function xhsSearchUrl(name) {
  return `https://www.xiaohongshu.com/search_result/?keyword=${encodeURIComponent(name)}`
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

/**
 * 年份配色：有记录的年份从旧到新依次取调色板。新增的通常是最新年份，
 * 已有年份的颜色不变；补录更早的年份时后面的颜色顺移。
 * @param {Iterable<number>} years
 * @returns {Map<number, string>}
 */
export function yearColors(years) {
  const sorted = [...new Set(years)].toSorted((a, b) => a - b)
  return new Map(
    sorted.map((year, index) => [
      year,
      YEAR_PALETTE[index % YEAR_PALETTE.length],
    ])
  )
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
 * 每站在全程的位置：`index` 是全程序号（0 起），`day` 是第几天（0 起），
 * `number` 是当天的序号（1 起）；详情列表和地图都用它。
 * @template {object} S
 * @param {{ days: { stops: S[] }[] }} trip
 * @returns {{ stop: S, index: number, day: number, number: number }[]}
 */
export function numberedStops(trip) {
  let index = 0
  return trip.days.flatMap((day, dayIndex) =>
    day.stops.map((stop, stopIndex) => ({
      stop,
      index: index++,
      day: dayIndex,
      number: stopIndex + 1,
    }))
  )
}

/**
 * `/trips/map.json` 里一段旅程的几何：各站坐标、序号与缩略图，逐段路径与方式。
 * @template P
 * @param {string} id
 * @param {{ title: string, start: string, end: string, days: { stops: { name: string, coordinates: [number, number], photos: P[], route?: { mode: string, path: [number, number][] } }[] }[] }} trip
 * @param {string} color 年份颜色，见 `yearColors`
 * @param {(photo: P) => string} [thumbnail] 第一张照片的缩略图地址
 */
export function tripMapData(id, trip, color, thumbnail) {
  const all = numberedStops(trip)
  return {
    id,
    title: trip.title,
    dates: formatDateRange(trip.start, trip.end),
    color,
    year: tripYear(trip),
    stops: all.map(({ stop, index, day, number }) => {
      const dayDate = trip.days[day]?.date
      const time =
        stop.time?.start ?? stop.time?.end ?? stop.route?.service?.depart
      return {
        name: stop.name,
        coordinates: stop.coordinates,
        index,
        day,
        number,
        ...(dayDate && { date: formatDayLabel(dayDate) }),
        ...(time && { time }),
        photo:
          thumbnail && stop.photos[0] ? thumbnail(stop.photos[0]) : undefined,
      }
    }),
    legs: all.flatMap(({ stop, index, day }) =>
      stop.route
        ? [{ from: index, day, mode: stop.route.mode, path: stop.route.path }]
        : []
    ),
  }
}

/**
 * 面板滚动时的阅读位置：跟在阅读线处；最后几项贴近底部够不到阅读线时，
 * 在最后一屏的滚动里平滑追上末尾，让最后一天和最后一站也能被完整滚过。
 * @param {{ end: number, maxScroll: number, readingLine: number, scrollTop: number, viewport: number }} input
 */
export function getReadingOffset({
  end,
  maxScroll,
  readingLine,
  scrollTop,
  viewport,
}) {
  const short = Math.max(0, end - (maxScroll + readingLine))
  const span = Math.min(maxScroll, Math.max(viewport, short * 2))
  const caughtUp =
    span > 0
      ? Math.min(Math.max((scrollTop - (maxScroll - span)) / span, 0), 1)
      : 1
  return scrollTop + readingLine + short * caughtUp
}

/**
 * `offset` 落在一组递增刻度里的哪一段，以及在该段内的比例（0–1）；
 * 在第一个刻度之前时返回 `{ index: -1, fraction: 0 }`。
 * @param {readonly number[]} offsets
 * @param {number} offset
 */
export function findBetweenMarks(offsets, offset) {
  const last = offsets.length - 1
  if (last < 0 || offset < offsets[0]) return { index: -1, fraction: 0 }
  for (let index = 0; index < last; index++) {
    const start = offsets[index]
    const end = offsets[index + 1]
    if (offset < end)
      return {
        index,
        fraction: end > start ? (offset - start) / (end - start) : 1,
      }
  }
  return { index: Math.max(last - 1, 0), fraction: 1 }
}
