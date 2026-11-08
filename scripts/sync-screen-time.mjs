/** 本机运行：读取 ActivityWatch 按日／应用聚合结果，不输出原始窗口信息。
 *
 * 仓库里的这一份是权威实现。安装器把它连同旁边两份校验／上传模块复制到本机应用目录，
 * 定时任务只跑复制品。旁边已有 `screen-time.js` 时用复制品，否则用仓库里的 `src/utils`。
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, hostname, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirnameOf(import.meta.url)
const bundled = existsSync(join(here, 'screen-time.js'))
const moduleHref = (name) =>
  pathToFileURL(bundled ? join(here, name) : join(here, '../src/utils', name))
    .href

const { parseScreenTime, SCREEN_TIME_ZONE, screenTimePeriods } = await import(
  moduleHref('screen-time.js')
)
const { writeScreenTime } = await import(moduleHref('screen-time-store.mjs'))

function dirnameOf(url) {
  return fileURLToPath(new URL('.', url))
}

/** 登录钥匙串与 Windows 计划任务共用的名字。凭证不进仓库、不进任务定义。 */
export const CREDENTIAL_SERVICE = 'site.wutongyu.screen-time'

/** 本机快照文件名。目录由 `agentHome` 决定，不在仓库里。 */
export const SNAPSHOT_PATH = 'screen-time.json'

/** macOS 与 Windows 各有一处用户级应用目录；其它系统不能安装采集任务。 */
export function agentHome({
  platform = process.platform,
  env = process.env,
  home = homedir(),
} = {}) {
  if (platform === 'win32')
    return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'YuBlog')
  if (platform === 'darwin')
    return join(home, 'Library', 'Application Support', 'YuBlog')
  throw new Error('Screen time: unsupported platform')
}

export const screenTimeSnapshotPath = (home = agentHome()) =>
  join(home, SNAPSHOT_PATH)

const WINDOWS_READ = `
$ErrorActionPreference = 'Stop'
$secure = Get-Content -Raw -LiteralPath $env:YUBLOG_TOKEN_FILE | ConvertTo-SecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
`

/** 读取安装器保存的写入凭证。失败时不带出命令参数。 */
export function readSavedToken({
  platform = process.platform,
  env = process.env,
  home = homedir(),
} = {}) {
  try {
    const stdout =
      platform === 'darwin'
        ? execFileSync(
            '/usr/bin/security',
            [
              'find-generic-password',
              '-s',
              CREDENTIAL_SERVICE,
              '-a',
              userInfo().username,
              '-w',
            ],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
          )
        : execFileSync(
            join(
              env.SystemRoot || 'C:\\Windows',
              'System32',
              'WindowsPowerShell',
              'v1.0',
              'powershell.exe'
            ),
            ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_READ],
            {
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'pipe'],
              env: {
                ...env,
                YUBLOG_TOKEN_FILE: join(
                  agentHome({ platform, env, home }),
                  'blob-token.dpapi'
                ),
              },
            }
          )
    const token = stdout.trim()
    if (!token) throw new Error('empty')
    return token
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Screen time:'))
      throw error
    throw new Error('Screen time: missing BLOB_READ_WRITE_TOKEN', {
      cause: error,
    })
  }
}

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

/** 环境变量只在这一次运行里覆盖已保存的凭证，不回读仓库 `.env`。 */
async function publishToken({ token, readCredential }) {
  if (token) return token
  if (process.env.BLOB_READ_WRITE_TOKEN)
    return process.env.BLOB_READ_WRITE_TOKEN
  const saved = await readCredential()
  if (!saved) throw new Error('Screen time: missing BLOB_READ_WRITE_TOKEN')
  return saved
}

export async function syncScreenTime({
  root = agentHome(),
  publish = false,
  client,
  token,
  readCredential = readSavedToken,
  ...options
} = {}) {
  await mkdir(root, { recursive: true })
  const lock = resolve(root, 'screen-time-sync.lock')
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
          token: await publishToken({ token, readCredential }),
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
