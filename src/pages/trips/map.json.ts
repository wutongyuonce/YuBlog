import type { APIRoute, ImageMetadata } from 'astro'
import { getImage } from 'astro:assets'

import { calendarMapData } from '~/utils/calendar.js'
import {
  getCalendarEntries,
  getTrips,
  getYearColors,
} from '~/utils/trip-entries'
import { tripMapData, tripYear } from '~/utils/trips.js'

/** 地图标记里的方形缩略图，按两倍像素生成。 */
async function thumbnail(image: ImageMetadata) {
  return (
    await getImage({
      src: image,
      width: 128,
      height: 128,
      fit: 'cover',
      format: 'webp',
    })
  ).src
}

/**
 * 旅行页地图的几何数据：年份配色、旅程（形状见 `tripMapData`）和有地点的日历记录
 * （形状见 `calendarMapData`）；文字与大图在页面 HTML 里。
 */
export const GET: APIRoute = async () => {
  const [trips, entries, colors] = await Promise.all([
    getTrips(),
    getCalendarEntries(),
    getYearColors(),
  ])
  // 先生成要用的缩略图，`tripMapData` 只做同步取值。
  const thumbs = new Map<string, string>()
  for (const image of [
    ...trips.flatMap((trip) =>
      trip.data.days.flatMap((day) =>
        day.stops.flatMap((stop) => stop.photos.slice(0, 1))
      )
    ),
    ...entries.flatMap((entry) => entry.data.photos.slice(0, 1)),
  ])
    thumbs.set(image.src, await thumbnail(image))
  const thumbOf = (image: ImageMetadata) => thumbs.get(image.src)!

  return new Response(
    JSON.stringify({
      years: [...colors].map(([year, color]) => ({ year, color })),
      trips: trips.map((trip) =>
        tripMapData(
          trip.id,
          trip.data,
          colors.get(tripYear(trip.data))!,
          thumbOf
        )
      ),
      calendar: entries.flatMap(({ id, data }) =>
        data.place
          ? [
              calendarMapData(
                id,
                { ...data, place: data.place },
                colors.get(Number(data.date.slice(0, 4)))!,
                data.photos[0] && thumbOf(data.photos[0])
              ),
            ]
          : []
      ),
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}
