#!/usr/bin/env node
/**
 * 圆周旅迹分享链接或手写草稿 → `src/data/trips/<id>/`（trip.json + 图片）。
 *
 *   pnpm trips:import '<分享链接或行程 ID>' [--id <站内 id>] [--check]
 *   pnpm trips:import --from <草稿.json> [--id <站内 id>] [--check]
 *
 * `--check` 只拉取、转换和校验，不下载图片、不请求公共路线服务、不写文件。
 * 转换规则在 `src/utils/pitravel.mjs` 与 `src/utils/trip-draft.mjs`，路线在
 * `src/utils/trip-routes.mjs`；这里只负责网络、图片、写盘前校验和原子落盘。
 * 设计见 docs/design/trips.md。
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { z } from 'astro/zod'
import sharp from 'sharp'

import { tripSchema } from '../src/content/schema.ts'
import {
  journeyDetailUrl,
  legRequests,
  parseJourneyId,
  ROUTE_URL,
  routeRequestBody,
  toTripDraft,
} from '../src/utils/pitravel.mjs'
import { parseTripDraft } from '../src/utils/trip-draft.mjs'
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
/** 每类问题的处理方向；skill 按这里的分类决定下一步。 */
const ISSUE_KINDS = {
  source: {
    title: '来源未覆盖',
    help: '圆周旅迹出现了适配器没覆盖的取值，需要更新 src/utils/pitravel.mjs。',
  },
  schema: {
    title: '本站 schema 表达不了',
    help: '数据超出了 tripSchema（src/content/schema.ts）的范围：扩展 schema 需先征得作者同意，否则在来源里调整或接受取舍。',
  },
  data: {
    title: '个别条目降级',
    help: '缺数据的条目已跳过或降级，不需要改代码。',
  },
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    id: { type: 'string' },
    from: { type: 'string' },
    check: { type: 'boolean', default: false },
  },
})
if (positionals.length !== (values.from ? 0 : 1)) {
  console.error(
    "用法：pnpm trips:import '<圆周旅迹分享链接或行程 ID>' [--id <站内 id>] [--check]\n" +
      '　　　pnpm trips:import --from <草稿.json> [--id <站内 id>] [--check]'
  )
  process.exit(1)
}
const check = values.check

const warnings = []

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { ...HEADERS, ...init.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`圆周旅迹返回 HTTP ${response.status}。`)
  return response.json()
}

/** 行程详情和它的路线；路线接口失败不终止，交给适配器记为降级。 */
async function readPitravel(input) {
  const detail = await fetchJson(journeyDetailUrl(parseJourneyId(input)))
  const requests = legRequests(detail)
  if (requests.length === 0) return toTripDraft(detail)
  const routes = await fetchJson(ROUTE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(routeRequestBody(requests)),
  }).catch((error) => ({ success: false, msg: error.message }))
  return toTripDraft(detail, routes)
}

/** 按类别打印问题；有 source 或 schema 类时返回 true。 */
function reportIssues(issues) {
  for (const [kind, { title, help }] of Object.entries(ISSUE_KINDS)) {
    const list = issues.filter((issue) => issue.kind === kind)
    if (list.length === 0) continue
    const log = kind === 'data' ? console.warn : console.error
    log(`\n【${title}】${help}`)
    for (const issue of list) log(`  - ${issue.message}`)
  }
  return issues.some((issue) => issue.kind !== 'data')
}

async function readImage(url) {
  if (!/^https?:\/\//.test(url)) return readFile(url)
  const response = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/**
 * 取一张图（远程或本地），缩到长边 1280 内：动图存成带动画的 WebP，其余转 JPEG。
 * 远程失败返回 undefined 并记警告；本地文件读不到是草稿写错了，直接终止导入。
 * `--check` 时不取图，只给出将要使用的文件名。
 */
async function saveImage(url, dir, base) {
  if (check) return `./${base}.jpg`
  try {
    const input = await readImage(url)
    const { pages = 1 } = await sharp(input).metadata()
    const animated = pages > 1
    const name = `${base}.${animated ? 'webp' : 'jpg'}`
    const image = sharp(input, { pages: animated ? -1 : 1 })
      .rotate()
      .resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
    await (
      animated
        ? image.webp({ quality: 80, loop: 0 })
        : image.jpeg({ quality: 80, mozjpeg: true })
    ).toFile(join(dir, name))
    return `./${name}`
  } catch (error) {
    if (!/^https?:\/\//.test(url))
      throw new Error(`本地图片读取失败：${url}（${error.message}）`, {
        cause: error,
      })
    warnings.push(`图片下载失败，已跳过：${url}（${error.message}）`)
    return undefined
  }
}

/** `--check` 不请求公共路线服务：没有来源路线的路段先按直线占位。 */
const offline = () => Promise.reject(new Error('check'))

/** 一段路：路线模块给出方式、里程和路径，再附上草稿里的班次或公交明细。 */
async function routeOf(stop, next) {
  const result = await requestRoute(
    {
      from: stop.coordinates,
      to: next.coordinates,
      mode: stop.travel,
      duration: stop.travelSeconds,
      hint: stop.routeHint,
    },
    check ? { fetchImpl: offline } : undefined
  )
  if (result.warning && !check)
    warnings.push(
      `「${stop.name} → ${next.name}」路线请求失败，按直线处理（${result.warning}）`
    )
  return {
    ...result.route,
    ...(stop.service && { service: stop.service }),
    ...(!result.route.transit && stop.transit && { transit: stop.transit }),
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

/** 与内容集合同一份 tripSchema；图片在这里只是相对路径。 */
function schemaIssues(trip) {
  const result = tripSchema({ image: () => z.string() }).safeParse(trip)
  if (result.success) return []
  return result.error.issues.map((issue) => ({
    kind: 'schema',
    message: `生成的 trip.json 在 ${issue.path.join('.') || '(根)'} 不符合 tripSchema：${issue.message}`,
  }))
}

const draft = values.from
  ? parseTripDraft(
      JSON.parse(await readFile(values.from, 'utf8')),
      dirname(resolve(values.from))
    )
  : await readPitravel(positionals[0])
const id = values.id ?? draft.start
if (!ID_PATTERN.test(id)) {
  console.error(`站内 id「${id}」只能包含小写字母、数字和连字符。`)
  process.exit(1)
}
if (reportIssues(draft.issues)) {
  console.error('\n转换没有通过，未写入任何文件。')
  process.exit(1)
}

const target = join(TRIPS_DIR, id)
const staging = join(TRIPS_DIR, `.import-${id}-${process.pid}`)
if (!check) {
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
}

try {
  const flat = draft.days.flatMap((day) => day.stops)
  const days = []
  for (const [dayIndex, day] of draft.days.entries()) {
    const stops = []
    for (const [stopIndex, stop] of day.stops.entries()) {
      const photos = []
      for (const [photoIndex, url] of stop.photoUrls.entries()) {
        const file = await saveImage(
          url,
          staging,
          `d${dayIndex + 1}-s${stopIndex + 1}-${photoIndex + 1}`
        )
        if (file) photos.push(file)
      }
      const next = flat[flat.indexOf(stop) + 1]
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
        route: next ? await routeOf(stop, next) : undefined,
      })
    }
    days.push({ date: day.date, summary: day.summary, stops })
  }

  // 拼图优先用本人在各站的照片；一张都没有时，
  // 才依次用草稿的封面候选和地点实景图兜底，最多三张。
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
      const file = await saveImage(url, staging, `cover-${cover.length + 1}`)
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
  if (reportIssues(schemaIssues(trip))) {
    console.error('\n生成的数据没有通过校验，未写入任何文件。')
    process.exitCode = 1
  } else {
    const routes = days.flatMap((day) =>
      day.stops.flatMap((stop) => stop.route ?? [])
    )
    const straight = routes.filter((route) => route.straight).length
    const photoCount = days.reduce(
      (sum, day) =>
        sum + day.stops.reduce((count, stop) => count + stop.photos.length, 0),
      0
    )
    const summary =
      `「${trip.title}」${trip.start} ~ ${trip.end}：${days.length} 天，${flat.length} 个地点，` +
      `${photoCount} 张照片；路线 ${routes.length - straight} 段，直线 ${straight} 段。`
    if (check) {
      console.log(`校验通过，将写入 src/data/trips/${id}/`)
      console.log(summary.replace('直线', '直线或待规划'))
    } else {
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
      console.log(`已写入 src/data/trips/${id}/`)
      console.log(summary)
    }
  }
} finally {
  await rm(staging, { recursive: true, force: true })
}

for (const warning of warnings) console.warn(`警告：${warning}`)
