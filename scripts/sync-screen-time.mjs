/** 本机运行：读取 ActivityWatch 按日／应用聚合结果，不输出原始窗口信息。 */
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  parseScreenTime,
  SCREEN_TIME_ZONE,
  screenTimePeriods,
} from '../src/utils/screen-time.js'

export const SNAPSHOT_PATH = 'public/data/screen-time.json'
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

const git = (root, args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

/** 不自动合并、拉取或暂存其它改动；离线推送留下的纯数据提交可在下次重试。 */
function checkPublish(root) {
  if (git(root, ['branch', '--show-current']) !== 'main')
    throw new Error('Screen time: publish requires main')
  git(root, ['fetch', 'origin', 'main'])
  git(root, ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'])
  const outgoing = git(root, [
    'log',
    '--format=',
    '--name-only',
    '--diff-merges=first-parent',
    'origin/main..HEAD',
  ])
  if (outgoing.split('\n').some((file) => file && file !== SNAPSHOT_PATH))
    throw new Error(
      'Screen time: publish refused; unrelated commits are pending'
    )
  if (git(root, ['diff', '--name-only', '--diff-filter=U']))
    throw new Error('Screen time: resolve Git conflicts before publishing')
}

/** 只看七天数据；同一份数据不重复提交，updatedAt 只随真实变化前进。 */
const sameDays = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export async function syncScreenTime({
  root = ROOT,
  publish = false,
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
    // 数据没变就不重写也不发布：周期性同步只在实际使用后产生提交与部署。
    const previous = await readFile(target, 'utf8')
      .then((contents) => parseScreenTime(JSON.parse(contents)))
      .catch(() => null)
    if (previous && sameDays(previous.days, snapshot.days))
      return { snapshot: previous, changed: false }
    if (publish) checkPublish(root)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`)
    await rename(temporary, target)
    if (publish) {
      // --only 保留用户已暂存的其它文件，不把它们夹带进每次提交。
      if (!git(root, ['ls-files', '--', SNAPSHOT_PATH]))
        git(root, ['add', '--', SNAPSHOT_PATH])
      if (git(root, ['status', '--porcelain', '--', SNAPSHOT_PATH]))
        git(root, [
          'commit',
          '--only',
          '-m',
          'chore: update screen time',
          '--',
          SNAPSHOT_PATH,
        ])
      git(root, ['push', 'origin', 'HEAD:main'])
    }
    return { snapshot, changed: true }
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
      const { snapshot, changed } = await syncScreenTime({
        publish: args.includes('--publish'),
        apiUrl: process.env.AW_URL,
        host: process.env.AW_HOSTNAME,
      })
      console.log(
        changed
          ? `Screen time: synced ${snapshot.days.at(-1).date} (${snapshot.updatedAt})`
          : `Screen time: unchanged since ${snapshot.updatedAt}`
      )
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : 'Screen time: sync failed'
      )
      process.exitCode = 1
    }
  }
}
