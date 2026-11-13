/**
 * 旅行与日历集合的唯一读取入口：排序与地图上的年份配色，供页面与 `/trips/map.json` 共用。
 * 展示规则在 `trips.js` 与 `calendar.js`，这里不再推断状态或统计。
 */
import { getCollection, type CollectionEntry } from 'astro:content'

import { entryYear, sortEntries } from './calendar.js'
import { tripYear, yearColors } from './trips.js'

export type TripEntry = CollectionEntry<'trips'>
export type CalendarEntry = CollectionEntry<'calendar'>

export async function getTrips(): Promise<TripEntry[]> {
  const trips = await getCollection('trips')
  return trips.toSorted(
    (a, b) =>
      b.data.start.localeCompare(a.data.start) || a.id.localeCompare(b.id)
  )
}

/** 全部日历记录，时间线顺序（新的在前）。 */
export async function getCalendarEntries(): Promise<CalendarEntry[]> {
  return sortEntries(await getCollection('calendar'), (entry) => entry.id)
}

/**
 * 地图上出现的年份及其颜色：旅程的开始年份与有地点的日历记录所在年份。
 * 页面、图例和地图载荷都用这一份，颜色不会对不上。
 */
export async function getYearColors(): Promise<Map<number, string>> {
  const [trips, entries] = await Promise.all([getTrips(), getCalendarEntries()])
  return yearColors([
    ...trips.map((trip) => tripYear(trip.data)),
    ...entries
      .filter((entry) => entry.data.place)
      .map((entry) => entryYear(entry.data)),
  ])
}
