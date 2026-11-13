/**
 * 日历的展示规则：月份、月格、排序、地址与地图载荷。
 * 页面和 `/trips/map.json` 都从这里读。数据形状见 `calendarSchema`（src/content/schema.ts）。
 */

import { formatDayLabel } from './trips.js'

/** 周一开头。 */
export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

/** `YYYY-MM-DD` → `YYYY-MM`。 */
export function monthKey(date) {
  return date.slice(0, 7)
}

/** 有记录的月份，从旧到新。 */
export function calendarMonths(entries) {
  return [...new Set(entries.map((entry) => monthKey(entry.date)))].toSorted()
}

/** 某月的页面地址，如 `/calendar/2026/11/`。 */
export function monthPath(key) {
  const [year, month] = key.split('-')
  return `/calendar/${year}/${month}/`
}

/** 选择器与标题里的月份，如「2026 年 11 月」。 */
export function formatMonth(key) {
  const [year, month] = key.split('-').map(Number)
  return `${year} 年 ${month} 月`
}

/**
 * 月视图的格子：周一开头，前后用 `undefined` 补满整周。
 * @param {string} key `YYYY-MM`
 * @returns {({ date: string, day: number } | undefined)[]}
 */
export function monthCells(key) {
  const [year, month] = key.split('-').map(Number)
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const lead = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7
  const cells = Array.from({ length: lead }, () => undefined)
  for (let day = 1; day <= days; day++)
    cells.push({ date: `${key}-${String(day).padStart(2, '0')}`, day })
  while (cells.length % 7 !== 0) cells.push(undefined)
  return cells
}

/**
 * 时间线顺序：新的在前；同一天有时间的按时间倒序，没写时间的排在当天最后。
 * @template {{ data: { date: string, time?: string } }} E
 * @param {E[]} entries
 * @param {(entry: E) => string} [tieBreaker] 同一时刻时的稳定次序
 */
export function sortEntries(entries, tieBreaker = () => '') {
  return entries.toSorted(
    (a, b) =>
      b.data.date.localeCompare(a.data.date) ||
      (b.data.time ?? '').localeCompare(a.data.time ?? '') ||
      tieBreaker(a).localeCompare(tieBreaker(b))
  )
}

/**
 * 记录的日期文字，如「11月10日 周二 · 19:30」。
 * @param {{ date: string, time?: string }} entry
 */
export function formatEntryDate({ date, time }) {
  return [formatDayLabel(date), time].filter(Boolean).join(' · ')
}

/** 记录在旅行页的地址片段；旅程 id 不含 `/`，不会撞上。 */
export function entryHash(id) {
  return `calendar/${id}`
}

/**
 * `/trips/map.json` 里一条有地点的记录。
 * @param {string} id
 * @param {{ title: string, date: string, place: { name: string, coordinates: [number, number] } }} entry
 * @param {string} color 年份颜色
 * @param {string} [photo] 第一张照片的缩略图地址
 */
export function calendarMapData(id, entry, color, photo) {
  return {
    id,
    hash: entryHash(id),
    title: entry.title,
    date: formatDayLabel(entry.date),
    place: entry.place.name,
    coordinates: entry.place.coordinates,
    year: Number(entry.date.slice(0, 4)),
    color,
    photo,
  }
}
