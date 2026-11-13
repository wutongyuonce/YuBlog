/**
 * 照片 EXIF 读取与按时间、地点分组：手动整理行程和日历条目时，
 * 从用户给的照片里取拍摄时间与坐标，归成候选地点。
 * 纯函数，不读文件、不联网；读图和逆地理编码在 `scripts/read-photos.mjs`。
 */
import { haversine } from './geo.mjs'

/** 用到的 TIFF 字段类型 → 单个值的字节数；UNDEFINED（如 MakerNote）不读。 */
const TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 9: 4, 10: 8 }
const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/
const OFFSET = /^[+-]\d{2}:\d{2}$/

const round6 = (value) => Math.round(value * 1e6) / 1e6

/**
 * 读一个 IFD 的全部条目，返回 `tag → 值`；越界或损坏时返回已读到的部分。
 * ASCII 返回去掉结尾 `\0` 的字符串，其余返回数组（有理数已换成小数）。
 */
function readIfd(tiff, start, little) {
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
  const entries = new Map()
  try {
    const count = view.getUint16(start, little)
    for (let index = 0; index < count; index++) {
      const at = start + 2 + index * 12
      const tag = view.getUint16(at, little)
      const type = view.getUint16(at + 2, little)
      const length = view.getUint32(at + 4, little)
      const size = TYPE_SIZES[type]
      if (!size) continue
      const offset =
        size * length <= 4 ? at + 8 : view.getUint32(at + 8, little)
      if (offset + size * length > view.byteLength) continue
      if (type === 2) {
        entries.set(
          tag,
          tiff.toString('latin1', offset, offset + length).replace(/\0+$/, '')
        )
        continue
      }
      const read = (i) => {
        const p = offset + i * size
        switch (type) {
          case 3:
            return view.getUint16(p, little)
          case 4:
            return view.getUint32(p, little)
          case 9:
            return view.getInt32(p, little)
          case 5:
            return view.getUint32(p, little) / view.getUint32(p + 4, little)
          case 10:
            return view.getInt32(p, little) / view.getInt32(p + 4, little)
          default:
            return view.getUint8(p)
        }
      }
      entries.set(
        tag,
        Array.from({ length }, (_, i) => read(i))
      )
    }
  } catch {
    // 截断的 IFD：保留已经读到的条目。
  }
  return entries
}

/** `YYYY:MM:DD HH:MM:SS` → `YYYY-MM-DDTHH:mm`（拍摄地的本地时刻）。 */
function toLocalTime(value) {
  const match = typeof value === 'string' && EXIF_DATE.exec(value)
  if (!match) return undefined
  const [, year, month, day, hour, minute] = match
  const date = `${year}-${month}-${day}`
  const midnight = new Date(`${date}T00:00:00Z`)
  if (
    year === '0000' ||
    Number.isNaN(midnight.getTime()) ||
    !midnight.toISOString().startsWith(date) ||
    hour > '23' ||
    minute > '59'
  )
    return undefined
  return `${date}T${hour}:${minute}`
}

/** 度分秒 + 南北／东西参考 → 带符号的十进制度。 */
function toDegrees(parts, ref) {
  if (!Array.isArray(parts) || parts.length !== 3) return undefined
  const [d, m, s] = parts
  const value = d + m / 60 + s / 3600
  if (!Number.isFinite(value)) return undefined
  return ref === 'S' || ref === 'W' ? -value : value
}

/**
 * 解析 EXIF 块（`sharp(...).metadata()` 的 `exif`，以 `Exif\0\0` 开头；
 * 也接受裸 TIFF 头）。读不出的部分直接省略，任何输入都不抛错。
 * @param {Uint8Array | undefined} buffer
 * @returns {{ takenAt?: string, offset?: string, coordinates?: [number, number], altitude?: number }}
 */
export function readExif(buffer) {
  if (!(buffer instanceof Uint8Array)) return {}
  const head = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const tiff = head.subarray(
    head.subarray(0, 6).toString('latin1') === 'Exif\0\0' ? 6 : 0
  )
  if (tiff.length < 8) return {}
  const order = tiff.toString('latin1', 0, 2)
  if (order !== 'II' && order !== 'MM') return {}
  const little = order === 'II'
  const u16 = (at) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at))
  const u32 = (at) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at))
  if (u16(2) !== 42) return {}

  const ifd0 = readIfd(tiff, u32(4), little)
  const sub = (tag) => {
    const start = ifd0.get(tag)?.[0]
    return Number.isInteger(start) ? readIfd(tiff, start, little) : new Map()
  }
  const exif = sub(0x8769)
  const gps = sub(0x8825)

  const result = {}
  const takenAt = toLocalTime(exif.get(0x9003)) ?? toLocalTime(ifd0.get(0x0132))
  if (takenAt) result.takenAt = takenAt
  const offset = exif.get(0x9011)
  if (typeof offset === 'string' && OFFSET.test(offset)) result.offset = offset
  const lat = toDegrees(gps.get(2), gps.get(1))
  const lng = toDegrees(gps.get(4), gps.get(3))
  if (
    lat !== undefined &&
    lng !== undefined &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  )
    result.coordinates = [round6(lng), round6(lat)]
  const altitude = gps.get(6)?.[0]
  if (Number.isFinite(altitude))
    result.altitude = gps.get(5)?.[0] === 1 ? -altitude : altitude
  return result
}

const minutesOf = (takenAt) =>
  Number(takenAt.slice(11, 13)) * 60 + Number(takenAt.slice(14, 16))

/**
 * 把照片归成候选地点：按拍摄时间排序（没有时间的按原顺序排在最后），
 * 日期变了、与上一张间隔超过 `gapMinutes`，或离本组第一张有坐标的照片
 * 超过 `radiusMeters` 时另起一组。
 * @param {{ file: string, takenAt?: string, coordinates?: [number, number] }[]} photos
 * @returns {{ date?: string, start?: string, end?: string, coordinates?: [number, number], files: string[] }[]}
 */
export function groupPhotos(
  photos,
  { gapMinutes = 90, radiusMeters = 500 } = {}
) {
  const sorted = [
    ...photos
      .filter((photo) => photo.takenAt)
      .sort((a, b) => a.takenAt.localeCompare(b.takenAt)),
    ...photos.filter((photo) => !photo.takenAt),
  ]
  const groups = []
  let current
  for (const photo of sorted) {
    const date = photo.takenAt?.slice(0, 10)
    const split =
      !current ||
      date !== current.date ||
      (date && minutesOf(photo.takenAt) - current.last > gapMinutes) ||
      (photo.coordinates &&
        current.anchor &&
        haversine(current.anchor, photo.coordinates) > radiusMeters)
    if (split) {
      current = { date, located: [], photos: [] }
      groups.push(current)
    }
    current.photos.push(photo)
    if (date) current.last = minutesOf(photo.takenAt)
    if (photo.coordinates) {
      current.anchor ??= photo.coordinates
      current.located.push(photo.coordinates)
    }
  }
  return groups.map(({ date, located, photos: members }) => {
    const timed = members.filter((photo) => photo.takenAt)
    const mean = (axis) =>
      round6(
        located.reduce((sum, point) => sum + point[axis], 0) / located.length
      )
    return {
      ...(date && {
        date,
        start: timed[0].takenAt.slice(11),
        end: timed.at(-1).takenAt.slice(11),
      }),
      ...(located.length > 0 && { coordinates: [mean(0), mean(1)] }),
      files: members.map((photo) => photo.file),
    }
  })
}
