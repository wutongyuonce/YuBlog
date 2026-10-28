/** 本机运行：读取 ActivityWatch 按日／应用聚合结果，不输出原始窗口信息。 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'

import {
  parseScreenTime,
  SCREEN_TIME_ZONE,
  screenTimePeriods,
} from '../src/utils/screen-time.js'
import { writeScreenTime } from '../src/utils/screen-time-store.mjs'

/** 仅供本机预览的数据副本，不再进入仓库；线上读取由接口负责。 */
export const SNAPSHOT_PATH = '.local/screen-time.json'
const ROOT = fileURLToPath(new URL('../', import.meta.url))

export async function fetchScreenTime({
  now = new Date(),
  fetchImpl = fetch,
  host = hostname(),
  apiUrl = 'http://127.0.0.1:5600',
} = {}) {
  const base = new URL(apiUrl)
  // ActivityWatch 的原始数据接口始终只在本机读取。
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) ||
    base.protocol !== 'http:' ||
    base.username ||
    base.password
  )
    throw new Error('Screen time: AW_URL must be a local HTTP address')
  const request = async (path, body) => {
    let response
    try {
      response = await fetchImpl(new URL(path, base), {
        method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
      })
      if (response.ok) return await response.json()
    } catch {
      // 不把可能包含原始记录的上游响应／异常写入日志。
      throw new Error('Screen time: ActivityWatch request failed')
    }
    throw new Error(`Screen time: ActivityWatch HTTP ${response.status}`)
  }
  const buckets = await request('/api/0/buckets/')
  const find = (client, type) => {
    const matches = Object.values(buckets).filter(
      (bucket) =>
        bucket?.client === client &&
        bucket.type === type &&
        bucket.hostname === host
    )
    if (matches.length !== 1 || typeof matches[0].id !== 'string')
      throw new Error(`Screen time: expected one local ${client} bucket`)
    return JSON.stringify(matches[0].id)
  }
  const afkBucket = find('aw-watcher-afk', 'afkstatus')
  const windowBucket = find('aw-watcher-window', 'currentwindow')
  const periods = screenTimePeriods(now)
  const results = await request('/api/0/query/', {
    timeperiods: periods.map(({ start, end }) => `${start}/${end}`),
    query: [
      `afk = query_bucket(${afkBucket});`,
      `win = query_bucket(${windowBucket});`,
      'active = filter_period_intersect(win, filter_keyvals(afk, "status", ["not-afk"]));',
      'RETURN = [sum_durations(active), sum_durations(win), sum_durations(afk), merge_events_by_keys(active, ["app"])];',
    ],
  })
  if (!Array.isArray(results) || results.length !== periods.length)
    throw new Error('Screen time: invalid ActivityWatch result')
  const days = periods.map(({ date, start, end }, index) => {
    const row = results[index]
    if (
      !Array.isArray(row) ||
      row.length !== 4 ||
      !Array.isArray(row[3]) ||
      row
        .slice(0, 3)
        .some(
          (seconds) =>
            typeof seconds !== 'number' ||
            !Number.isFinite(seconds) ||
            seconds < 0
        ) ||
      row[0] >
        Math.min(row[1], row[2], (Date.parse(end) - Date.parse(start)) / 1000) +
          1
    )
      throw new Error('Screen time: invalid ActivityWatch duration')
    return {
      date,
      seconds: Math.round(row[0]),
      apps: row[3]
        .filter((event) => event.duration !== 0)
        .map((event) => ({ name: event.data?.app, seconds: event.duration })),
    }
  })
  // 先校验应用条目，再判断是否缺采集，避免空态吞掉畸形数据并覆盖旧快照。
  const snapshot = parseScreenTime({
    timeZone: SCREEN_TIME_ZONE,
    updatedAt: now.toISOString(),
    days,
  })
  snapshot.days.forEach((day, index) => {
    if (results[index][1] === 0 || results[index][2] === 0) {
      if (results[index][0] !== 0 || day.apps.length)
        throw new Error('Screen time: activity without collection')
      day.seconds = null
      day.apps = null
    }
  })
  return snapshot
}

/** 只看七天数据；只用于报告这次运行是否带来新活跃记录。 */
const sameDays = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** launchd 不加载 `.env`，这里按 Astro 的约定补读工作目录下的同名文件。 */
async function publishToken(root) {
  const fromEnv = process.env.BLOB_READ_WRITE_TOKEN
  if (fromEnv) return fromEnv
  const contents = await readFile(resolve(root, '.env'), 'utf8').catch(() => '')
  return parseEnv(contents).BLOB_READ_WRITE_TOKEN
}

export async function syncScreenTime({
  root = ROOT,
  publish = false,
  client,
  ...options
} = {}) {
  const local = resolve(root, '.local')
  await mkdir(local, { recursive: true })
  const lock = resolve(local, 'screen-time-sync.lock')
  await mkdir(lock)
  const target = resolve(root, SNAPSHOT_PATH)
  const temporary = `${target}.tmp`
  try {
    const snapshot = await fetchScreenTime(options)
    const previous = await readFile(target, 'utf8')
      .then((contents) => parseScreenTime(JSON.parse(contents)))
      .catch(() => null)
    // 先推远端再写本地：上传失败时本地仍是旧数据，下一次运行会重新尝试。
    // 远端不按本地副本去重：副本只说明本机上次同步的结果，不能证明对象还在，
    // 更不能证明它没被删掉；每小时覆盖一次仍在 Blob 的额度内。
    const url = publish
      ? await writeScreenTime(snapshot, {
          token: await publishToken(root),
          client,
        })
      : null
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`)
    await rename(temporary, target)
    return {
      snapshot,
      changed: !previous || !sameDays(previous.days, snapshot.days),
      url,
    }
  } finally {
    await rm(temporary, { force: true })
    await rm(lock, { recursive: true, force: true })
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== '--publish')) {
    console.error('Usage: node scripts/sync-screen-time.mjs [--publish]')
    process.exitCode = 1
  } else {
    try {
      const { snapshot, changed, url } = await syncScreenTime({
        publish: args.includes('--publish'),
        apiUrl: process.env.AW_URL,
        host: process.env.AW_HOSTNAME,
      })
      if (url)
        console.log(
          `Screen time: published ${snapshot.days.at(-1).date} (${snapshot.updatedAt}) to ${url}`
        )
      else
        console.log(
          `Screen time: ${changed ? 'synced' : 'unchanged'} ${snapshot.days.at(-1).date} (${snapshot.updatedAt})`
        )
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : 'Screen time: sync failed'
      )
      process.exitCode = 1
    }
  }
}
