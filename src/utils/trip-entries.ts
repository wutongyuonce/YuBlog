/**
 * 旅行集合的唯一读取入口：按开始日期倒序（同日按 id），供页面与 `/trips/map.json` 共用。
 * 展示规则在 `trips.js`，这里不再推断状态或统计。
 */
import { getCollection, type CollectionEntry } from 'astro:content'

export type TripEntry = CollectionEntry<'trips'>

export async function getTrips(): Promise<TripEntry[]> {
  const trips = await getCollection('trips')
  return trips.toSorted(
    (a, b) =>
      b.data.start.localeCompare(a.data.start) || a.id.localeCompare(b.id)
  )
}
