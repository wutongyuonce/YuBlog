/** 旅行导入与回放共用的大圆距离：路线距离和回放时间线按同一个公式计算。 */

export const EARTH_RADIUS = 6_371_008.8

/**
 * 两点大圆距离（米）。
 * @param {[number, number]} a `[经度, 纬度]`
 * @param {[number, number]} b `[经度, 纬度]`
 */
export function haversine([lng1, lat1], [lng2, lat2]) {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)))
}
