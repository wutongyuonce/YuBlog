#!/usr/bin/env node
/**
 * 圆周旅迹分享链接 → `src/data/trips/<id>/`（trip.json + 图片）。
 *
 *   pnpm trips:import '<分享链接或行程 ID>' [--id <站内 id>]
 *
 * 转换规则在 `src/utils/pitravel.mjs`，路线在 `src/utils/trip-routes.mjs`；
 * 这里只负责网络、图片和原子落盘。设计见 docs/design/trips.md。
 */
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import sharp from 'sharp'

import {
  journeyDetailUrl,
  parseJourneyId,
  toTripDraft,
} from '../src/utils/pitravel.mjs'
import { requestRoute } from '../src/utils/trip-routes.mjs'

const TRIPS_DIR = resolve(import.meta.dirname, '../src/data/trips')
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const MAX_EDGE = 1280
const FALLBACK_COVERS = 3
const TIMEOUT_MS = 15_000
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (YuBlog trips import)',
  'Referer': 'https://www.pitravel.cn/',
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { id: { type: 'string' } },
})
if (positionals.length !== 1) {
  console.error(
    "用法：pnpm trips:import '<圆周旅迹分享链接或行程 ID>' [--id <站内 id>]"
  )
  process.exit(1)
}

const warnings = []

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`圆周旅迹返回 HTTP ${response.status}。`)
  return response.json()
}

/** 下载一张图，缩到长边 1280 内转 JPEG；失败返回 undefined 并记警告。 */
async function saveImage(url, dir, name) {
  try {
    const response = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const input = Buffer.from(await response.arrayBuffer())
    await sharp(input)
      .rotate()
      .resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80, mozjpeg: true })
      .toFile(join(dir, name))
    return `./${name}`
  } catch (error) {
    warnings.push(`图片下载失败，已跳过：${url}（${error.message}）`)
    return undefined
  }
}

/** 坐标与路径各占一行，其余按两格缩进；该文件不走 Prettier。 */
function serialize(trip) {
  const inline = []
  const json = JSON.stringify(
    trip,
    (key, value) =>
      key === 'path' || key === 'coordinates'
        ? `__INLINE_${inline.push(JSON.stringify(value)) - 1}__`
        : value,
    2
  )
  return `${json.replace(/"__INLINE_(\d+)__"/g, (_, index) => inline[index])}\n`
}

const journeyId = parseJourneyId(positionals[0])
const draft = toTripDraft(await fetchJson(journeyDetailUrl(journeyId)))
const id = values.id ?? draft.start
if (!ID_PATTERN.test(id)) {
  console.error(`站内 id「${id}」只能包含小写字母、数字和连字符。`)
  process.exit(1)
}
for (const name of draft.skipped)
  warnings.push(`缺少坐标或名称，未导入：${name}`)

const target = join(TRIPS_DIR, id)
const staging = join(TRIPS_DIR, `.import-${id}-${process.pid}`)
await rm(staging, { recursive: true, force: true })
await mkdir(staging, { recursive: true })

try {
  const flat = draft.days.flatMap((day) => day.stops)
  let routed = 0
  let straightLegs = 0
  const days = []
  for (const [dayIndex, day] of draft.days.entries()) {
    const stops = []
    for (const [stopIndex, stop] of day.stops.entries()) {
      const photos = []
      for (const [photoIndex, url] of stop.photoUrls.entries()) {
        const file = await saveImage(
          url,
          staging,
          `d${dayIndex + 1}-s${stopIndex + 1}-${photoIndex + 1}.jpg`
        )
        if (file) photos.push(file)
      }
      const next = flat[flat.indexOf(stop) + 1]
      let route
      if (next) {
        const result = await requestRoute({
          from: stop.coordinates,
          to: next.coordinates,
          mode: stop.travel,
          duration: stop.travelSeconds,
        })
        route = result.route
        if (result.warning)
          warnings.push(
            `「${stop.name} → ${next.name}」路线请求失败，按直线处理（${result.warning}）`
          )
        if (route.mode === 'straight') straightLegs++
        else routed++
      }
      stops.push({
        name: stop.name,
        category: stop.category,
        emoji: stop.emoji,
        address: stop.address,
        coordinates: stop.coordinates.map(
          (value) => Math.round(value * 1e6) / 1e6
        ),
        time: stop.time,
        note: stop.note,
        photos,
        route,
      })
    }
    days.push({ date: day.date, summary: day.summary, stops })
  }

  // 拼图优先用本人在各站上传的照片；一张都没有时，
  // 才依次用圆周的行程封面和地点实景图兜底，最多三张。
  const cover = []
  const hasStopPhotos = days.some((day) =>
    day.stops.some((stop) => stop.photos.length > 0)
  )
  if (!hasStopPhotos) {
    const fallbacks = [
      ...new Set([
        ...draft.coverUrls,
        ...flat.map((stop) => stop.placeImageUrl).filter(Boolean),
      ]),
    ]
    for (const url of fallbacks) {
      if (cover.length >= FALLBACK_COVERS) break
      const file = await saveImage(
        url,
        staging,
        `cover-${cover.length + 1}.jpg`
      )
      if (file) cover.push(file)
    }
  }

  const trip = {
    title: draft.title,
    start: draft.start,
    end: draft.end,
    cover,
    days,
  }
  await writeFile(join(staging, 'trip.json'), serialize(trip))

  // 点开头的目录不会被内容集合收录；替换失败时把旧目录搬回去。
  const previous = join(TRIPS_DIR, `.previous-${id}-${process.pid}`)
  const hadPrevious = existsSync(target)
  if (hadPrevious) await rename(target, previous)
  try {
    await rename(staging, target)
  } catch (error) {
    if (hadPrevious) await rename(previous, target)
    throw error
  }
  await rm(previous, { recursive: true, force: true })

  const photoCount = days.reduce(
    (sum, day) =>
      sum + day.stops.reduce((count, stop) => count + stop.photos.length, 0),
    0
  )
  console.log(`已写入 src/data/trips/${id}/`)
  console.log(
    `「${trip.title}」${trip.start} ~ ${trip.end}：${days.length} 天，${flat.length} 个地点，` +
      `${photoCount} 张照片，封面候选 ${cover.length} 张；路线 ${routed} 段，直线 ${straightLegs} 段。`
  )
} catch (error) {
  await rm(staging, { recursive: true, force: true })
  throw error
}

for (const warning of warnings) console.warn(`警告：${warning}`)
