import type { APIRoute } from 'astro'

import { getTrips } from '~/utils/trip-entries'
import { tripMapData } from '~/utils/trips.js'

/** 旅行页地图的几何数据；文字与图片在页面 HTML 里。形状见 `tripMapData`。 */
export const GET: APIRoute = async () => {
  const trips = await getTrips()
  return new Response(
    JSON.stringify({
      trips: trips.map((trip) => tripMapData(trip.id, trip.data)),
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}
