#!/usr/bin/env node
/**
 * 照片 → 尺寸、拍摄时间、坐标与候选地点，JSON 输出到 stdout，
 * 供手动整理行程草稿和日历条目时参考；不写任何文件。
 *
 *   pnpm trips:photos <照片或目录>... [--geocode]
 *
 * 目录会递归查找图片。EXIF 解析与分组在 `src/utils/photo-exif.mjs`；
 * `--geocode` 用 Nominatim 给每个候选地点补名称和地址（每秒最多一次请求）。
 * 提示和失败写到 stderr，不影响 stdout 的 JSON。
 */
import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import sharp from 'sharp'

import { groupPhotos, readExif } from '../src/utils/photo-exif.mjs'

const IMAGE = /\.(jpe?g|png|webp|gif|tiff?|heic|heif)$/i
const HEIF = /\.hei[cf]$/i
const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse'
const HEADERS = {
  'User-Agent': 'YuBlog trips:photos (https://www.wutongyu.site/)',
}
const TIMEOUT_MS = 15_000
const INTERVAL_MS = 1_000

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { geocode: { type: 'boolean', default: false } },
})
if (positionals.length === 0) {
  console.error('用法：pnpm trips:photos <照片或目录>... [--geocode]')
  process.exit(1)
}

/** 命令行给的文件原样保留；目录里只取图片扩展名的文件，重复的只算一次。 */
async function collect(inputs) {
  const files = new Set()
  for (const input of inputs.map((path) => resolve(path))) {
    if (!(await stat(input)).isDirectory()) {
      files.add(input)
      continue
    }
    const entries = await readdir(input, { recursive: true })
    for (const entry of entries.sort())
      if (IMAGE.test(entry)) files.add(join(input, entry))
  }
  return files
}

/** 一张图的尺寸、动图标记和 EXIF；HEIC 解码不了时仍保留元数据并提示转换。 */
async function readPhoto(file) {
  const meta = await sharp(file).metadata()
  const { width, height } = meta.autoOrient ?? meta
  if (HEIF.test(file)) {
    await sharp(file)
      .resize(8)
      .toBuffer()
      .catch(() =>
        console.warn(
          `HEIC／HEIF 无法解码，导入前先转成 JPEG：sips -s format jpeg '${file}' --out '${file.replace(HEIF, '.jpg')}'`
        )
      )
  }
  const { takenAt, offset, coordinates } = readExif(meta.exif)
  return {
    file,
    width,
    height,
    animated: (meta.pages ?? 1) > 1,
    takenAt,
    offset,
    coordinates,
  }
}

let lastRequest = 0
/** Nominatim 逆地理编码；使用条款要求每秒最多一次请求并带可识别的 User-Agent。 */
async function reverse([lng, lat]) {
  await sleep(Math.max(0, lastRequest + INTERVAL_MS - Date.now()))
  lastRequest = Date.now()
  const url = `${NOMINATIM}?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=zh-CN`
  const response = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const result = await response.json()
  if (result.error) throw new Error(result.error)
  return { name: result.name || undefined, address: result.display_name }
}

const photos = []
for (const file of await collect(positionals)) {
  try {
    photos.push(await readPhoto(file))
  } catch (error) {
    console.warn(
      HEIF.test(file)
        ? `HEIC／HEIF 读取失败，先转成 JPEG 再读：sips -s format jpeg '${file}' --out '${file.replace(HEIF, '.jpg')}'`
        : `读取失败，已跳过：${file}（${error.message}）`
    )
  }
}

const places = groupPhotos(photos)
if (values.geocode) {
  for (const place of places) {
    if (!place.coordinates) continue
    try {
      Object.assign(place, await reverse(place.coordinates))
    } catch (error) {
      console.warn(
        `逆地理编码失败：${place.coordinates.join(', ')}（${error.message}）`
      )
    }
  }
}

console.log(JSON.stringify({ photos, places }, null, 2))
