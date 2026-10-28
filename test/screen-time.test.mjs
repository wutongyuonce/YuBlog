import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  buildScreenTimeChart,
  formatScreenTime,
  formatScreenTimeExact,
  parseScreenTime,
  screenTimeDayLabel,
  screenTimePeriods,
} from '../src/utils/screen-time.js'
import {
  fetchScreenTime,
  SNAPSHOT_PATH,
  syncScreenTime,
} from '../scripts/sync-screen-time.mjs'
import {
  launchAgentPlist,
  LABEL,
} from '../scripts/install-screen-time-launchd.mjs'

const now = new Date('2026-10-27T12:00:00Z')
const host = 'test-machine'
const event = (app, duration) => ({
  data: { app, title: 'private window', url: 'private URL' },
  duration,
})
const fixture = (
  results = Array.from({ length: 7 }, () => [
    1800.4,
    3600,
    7200,
    [event('Safari', 1800.4)],
  ])
) => {
  const calls = []
  return {
    now,
    host,
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options })
      assert.ok(options.signal instanceof AbortSignal)
      const data = url.pathname.endsWith('buckets/')
        ? {
            a: {
              id: 'afk-local',
              hostname: host,
              client: 'aw-watcher-afk',
              type: 'afkstatus',
            },
            b: {
              id: 'window-local',
              hostname: host,
              client: 'aw-watcher-window',
              type: 'currentwindow',
            },
            c: {
              id: 'window-other',
              hostname: 'other-machine',
              client: 'aw-watcher-window',
              type: 'currentwindow',
            },
          }
        : results
      return new Response(JSON.stringify(data))
    },
  }
}
/** 每次取用都与磁盘上已有快照不同，驱动发布路径。 */
let dayCounter = 0
const newDay = () => {
  dayCounter += 1
  const seconds = 1800.4 + dayCounter * 60
  return Array.from({ length: 7 }, () => [
    seconds,
    7200,
    7200,
    [event('Safari', seconds)],
  ])
}

const sandbox = async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'yublog-screen-time-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

/** 记录远端覆盖写入；`put` 可换成失败版本以驱动重试路径。 */
const blobStore = (
  put = async () => ({ url: 'https://blob.test/screen-time.json' })
) => {
  const writes = []
  return {
    writes,
    client: {
      put: async (pathname, body, options) => {
        writes.push({ pathname, body, options })
        return await put(pathname, body, options)
      },
    },
  }
}

test('seven calendar days roll over at Beijing midnight, including leap days and stale labels', () => {
  const instant = new Date('2024-02-29T16:00:01Z')
  const periods = screenTimePeriods(instant)
  assert.equal(periods.length, 7)
  assert.deepEqual(periods.at(-2), {
    date: '2024-02-29',
    start: '2024-02-28T16:00:00.000Z',
    end: '2024-02-29T16:00:00.000Z',
  })
  assert.deepEqual(periods.at(-1), {
    date: '2024-03-01',
    start: '2024-02-29T16:00:00.000Z',
    end: '2024-02-29T16:00:01.000Z',
  })
  assert.equal(screenTimeDayLabel('2024-02-29', instant), '2 月 29 日活跃')
  assert.equal(screenTimeDayLabel('2024-03-01', instant), '今天活跃')
})

test('only this machine’s safe aggregates are published; missing collection differs from recorded zero', async () => {
  const options = fixture([
    [0, 0, 0, []],
    [0, 0, 600, []],
    [0, 600, 600, []],
    ...Array.from({ length: 4 }, () => [
      1800.4,
      3600,
      7200,
      [event('Safari', 1800.4)],
    ]),
  ])
  const snapshot = await fetchScreenTime(options)
  assert.deepEqual(
    snapshot.days.map((day) => day.seconds),
    [null, null, 0, 1800, 1800, 1800, 1800]
  )
  assert.deepEqual(Object.keys(snapshot), ['timeZone', 'updatedAt', 'days'])
  assert.deepEqual(Object.keys(snapshot.days[0]), ['date', 'seconds', 'apps'])
  assert.deepEqual(snapshot.days.at(-1).apps, [
    { name: 'Safari', seconds: 1800.4 },
  ])
  assert.equal(options.calls.length, 2)
  const query = JSON.parse(options.calls[1].body)
  assert.equal(
    query.timeperiods[0],
    '2026-10-20T16:00:00.000Z/2026-10-21T16:00:00.000Z'
  )
  assert.equal(query.timeperiods.at(-1).split('/')[1], now.toISOString())
  assert.match(query.query.join(''), /filter_period_intersect/)
  assert.match(
    query.query.join(''),
    /filter_keyvals\(.*"status", \["not-afk"\]/
  )
  assert.match(query.query.join(''), /query_bucket\("window-local"\)/)
  assert.ok(!query.query.join('').includes('window-other'))
  assert.match(query.query.at(-1), /merge_events_by_keys\(.*\["app"\]/)
  assert.ok(!JSON.stringify(snapshot).includes('private'))
  const safe = parseScreenTime({
    ...snapshot,
    title: 'private',
    days: snapshot.days.map((day) => ({ ...day, app: 'private' })),
  })
  assert.ok(!JSON.stringify(safe).includes('private'))
  assert.deepEqual([null, 0, 20, 3660, 3600].map(formatScreenTime), [
    '暂无记录',
    '0 分钟',
    '不到 1 分钟',
    '1 小时 1 分钟',
    '1 小时',
  ])
  assert.equal(formatScreenTimeExact(3661), '1时1分1秒')
  assert.equal(formatScreenTimeExact(0.1), '不到 1 秒')
})

test('a full day survives rounding without rejecting the whole snapshot', async () => {
  // 23:00+08:00 today leaves room for a closed previous day of the full 86400s.
  const fullDay = [86400.4, 86400.5, 86400.5, [event('Safari', 86400.4)]]
  const rows = Array.from({ length: 7 }, () => [
    1800.4,
    3600,
    7200,
    [event('Safari', 1800.4)],
  ])
  rows[5] = fullDay
  const snapshot = await fetchScreenTime(fixture(rows))
  assert.equal(snapshot.days[5].seconds, 86400)
  assert.equal(snapshot.days[5].apps[0].seconds, 86400.4)
  // One second over the day is still rejected.
  const over = [...rows]
  over[5] = [86500, 86500, 86500, [event('Safari', 86500)]]
  await assert.rejects(fetchScreenTime(fixture(over)), /duration|daily|total/)
})

test('malformed data is rejected even on days with no collection', async () => {
  for (const row of [
    [-1, 100, 100, []],
    ['60', 100, 100, [event('Safari', 60)]],
    [200, 100, 100, [event('Safari', 200)]],
    [90000, 90000, 90000, [event('Safari', 90000)]],
    [1, 2],
    [0, 0, 600, [event('Bad', -20)]],
    [0, 0, 600, [event('Ghost', 0.1)]],
    [10, 100, 100, [event('Dup', 5), event('Dup', 5)]],
    [10, 100, 100, [event('Wrong total', 30)]],
    [1, 100, 100, [event('', 1)]],
  ])
    await assert.rejects(
      fetchScreenTime(fixture(Array.from({ length: 7 }, () => row)))
    )
  await assert.rejects(fetchScreenTime(fixture([])), /result/)
  await assert.rejects(
    fetchScreenTime({ ...fixture(), host: 'missing' }),
    /expected one/
  )
  await assert.rejects(
    fetchScreenTime({ apiUrl: 'https://example.com' }),
    /local HTTP/
  )
  const snapshot = await fetchScreenTime(fixture())
  snapshot.days[0].date = '2026-10-01'
  assert.throws(() => parseScreenTime(snapshot), /daily/)
})

test('the existing total-only snapshot keeps its duration and marks missing app details separately', async () => {
  const snapshot = await fetchScreenTime(fixture())
  const legacy = {
    ...snapshot,
    days: snapshot.days.map(({ apps: _apps, ...day }) => day),
  }
  const chart = buildScreenTimeChart(parseScreenTime(legacy))
  assert.equal(chart.days[6].seconds, snapshot.days[6].seconds)
  assert.equal(chart.days[6].details.length, 0)
  assert.deepEqual(chart.legend, [{ name: '明细缺失', slot: 6 }])
  assert.deepEqual(chart.days[6].segments, [{ slot: 6, percent: 100 }])
})

test('seven days share weekly colors, retain tiny apps and regroup after a new snapshot', async () => {
  const row = (apps) => {
    const total = apps.reduce((sum, app) => sum + app.duration, 0)
    return [total, total + 60, total + 120, apps]
  }
  const rows = Array.from({ length: 7 }, (_, i) =>
    row([
      event('Ghostty', i % 2 ? 100 : 400),
      event('Safari', i % 2 ? 400 : 100),
      event('Notes', 30 + i),
      event('Chat', 20),
      event('Finder', 10),
      event(i === 6 ? 'New app' : 'Tiny app', i === 6 ? 0.1 : i + 1),
    ])
  )
  const first = buildScreenTimeChart(await fetchScreenTime(fixture(rows)))
  assert.deepEqual(
    first.legend.map(({ name }) => name),
    ['Ghostty', 'Safari', 'Notes', 'Chat', 'Finder', '其他']
  )
  const check = (chart, sourceRows) => {
    for (let i = 0; i < 7; i++) {
      const day = chart.days[i]
      const total = sourceRows[i][0]
      assert.equal(day.details.length, sourceRows[i][3].length)
      assert.equal(day.seconds, Math.round(total))
      assert.ok(
        Math.abs(
          day.segments.reduce((sum, segment) => sum + segment.percent, 0) - 100
        ) < 1e-9
      )
      for (const app of day.details) {
        const named = chart.legend.find(({ name }) => name === app.name)
        assert.equal(app.slot, named?.slot ?? 5)
        assert.ok(Math.abs(app.percent - (app.seconds / total) * 100) < 1e-9)
      }
      const otherSeconds = day.details
        .filter((app) => app.slot === 5)
        .reduce((sum, app) => sum + app.seconds, 0)
      assert.ok(
        Math.abs(
          day.segments.find((segment) => segment.slot === 5).percent -
            (otherSeconds / total) * 100
        ) < 1e-9
      )
    }
  }
  check(first, rows)
  assert.equal(first.days[0].details[0].name, 'Ghostty')
  assert.equal(first.days[1].details[0].name, 'Safari')
  const tiny = first.days[6].details.find((app) => app.name === 'New app')
  assert.equal(tiny.seconds, 0.1)
  assert.ok(tiny.percent > 0 && tiny.percent < 0.1)
  const updated = [...rows]
  updated[0] = row([...rows[0][3], event('New app', 10000)])
  const second = buildScreenTimeChart(await fetchScreenTime(fixture(updated)))
  assert.equal(second.legend[0].name, 'New app')
  assert.equal(
    second.days[6].details.find((app) => app.name === 'New app').slot,
    0
  )
  assert.equal(
    second.days[6].details.find((app) => app.name === 'Finder').slot,
    5
  )
  check(second, updated)
  assert.equal(first.legend[0].name, 'Ghostty')
})

test('failed sync retains the previous preview and releases the lock for a later retry', async (t) => {
  const root = await sandbox(t)
  await mkdir(join(root, '.local'), { recursive: true })
  const target = join(root, SNAPSHOT_PATH)
  await writeFile(target, 'previous snapshot')
  await assert.rejects(
    syncScreenTime({
      root,
      fetchImpl: async () => {
        throw new Error('private response')
      },
    }),
    /request failed/
  )
  assert.equal(await readFile(target, 'utf8'), 'previous snapshot')
  const { snapshot, changed } = await syncScreenTime({ root, ...fixture() })
  assert.equal(changed, true)
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), snapshot)
})

test('publishing overwrites one fixed path and keeps the preview outside the repository', async (t) => {
  const root = await sandbox(t)
  await writeFile(join(root, '.env'), 'BLOB_READ_WRITE_TOKEN=file-token\n')
  const store = blobStore()
  const { snapshot, changed, url } = await syncScreenTime({
    root,
    publish: true,
    client: store.client,
    ...fixture(),
  })
  assert.equal(changed, true)
  assert.equal(url, 'https://blob.test/screen-time.json')
  assert.equal(store.writes.length, 1)
  const [write] = store.writes
  assert.equal(write.pathname, 'screen-time.json')
  // 覆盖写入的选项与缓存头属于存储模块，已在端点测试里钉住；这里只看同步是否
  // 传入了正确的 token，以及是否在写本地副本之前完成上传。
  assert.equal(write.options.token, 'file-token')
  assert.deepEqual(JSON.parse(write.body), snapshot)
  assert.deepEqual(
    JSON.parse(await readFile(join(root, SNAPSHOT_PATH), 'utf8')),
    snapshot
  )
})

test('a failed upload keeps the previous preview so the next run publishes again', async (t) => {
  const root = await sandbox(t)
  await writeFile(join(root, '.env'), 'BLOB_READ_WRITE_TOKEN=file-token\n')
  await syncScreenTime({
    root,
    publish: true,
    client: blobStore().client,
    ...fixture(),
  })
  const before = await readFile(join(root, SNAPSHOT_PATH), 'utf8')
  const broken = blobStore(async () => {
    throw new Error('blob unavailable')
  })
  await assert.rejects(
    syncScreenTime({
      root,
      publish: true,
      client: broken.client,
      ...fixture(newDay()),
    }),
    /blob unavailable/
  )
  assert.equal(await readFile(join(root, SNAPSHOT_PATH), 'utf8'), before)
  const retry = blobStore()
  const { snapshot, changed } = await syncScreenTime({
    root,
    publish: true,
    client: retry.client,
    ...fixture(newDay()),
  })
  assert.equal(changed, true)
  assert.equal(retry.writes.length, 1)
  assert.deepEqual(JSON.parse(retry.writes[0].body), snapshot)
})

test('the environment token wins over .env for publishing', async (t) => {
  const root = await sandbox(t)
  await writeFile(join(root, '.env'), 'BLOB_READ_WRITE_TOKEN=file-token\n')
  const store = blobStore()
  const previous = process.env.BLOB_READ_WRITE_TOKEN
  process.env.BLOB_READ_WRITE_TOKEN = 'env-token'
  try {
    await syncScreenTime({
      root,
      publish: true,
      client: store.client,
      ...fixture(),
    })
  } finally {
    if (previous === undefined) delete process.env.BLOB_READ_WRITE_TOKEN
    else process.env.BLOB_READ_WRITE_TOKEN = previous
  }
  assert.equal(store.writes[0].options.token, 'env-token')
})

test('an idle hour still republishes and reports no new activity', async (t) => {
  const root = await sandbox(t)
  await writeFile(join(root, '.env'), 'BLOB_READ_WRITE_TOKEN=file-token\n')
  const store = blobStore()
  const first = await syncScreenTime({
    root,
    publish: true,
    client: store.client,
    ...fixture(),
  })
  assert.equal(first.changed, true)
  assert.equal(store.writes.length, 1)
  // 远端不按本地副本去重：没有新活跃记录也覆盖写一次，本地副本随之刷新。
  // 这样副本丢失、存储被重建时下一个整点就能自愈，而不是等数据变化。
  const later = await syncScreenTime({
    root,
    publish: true,
    client: store.client,
    ...fixture(),
    now: new Date(now.getTime() + 3_600_000),
  })
  assert.equal(later.changed, false)
  assert.equal(store.writes.length, 2)
  assert.deepEqual(
    JSON.parse(store.writes[1].body).days,
    JSON.parse(store.writes[0].body).days
  )
  assert.equal(
    JSON.parse(await readFile(join(root, SNAPSHOT_PATH), 'utf8')).updatedAt,
    later.snapshot.updatedAt
  )
  // New activity in the current day is a real change again.
  const rows = Array.from({ length: 7 }, () => [
    1800.4,
    3600,
    7200,
    [event('Safari', 1800.4)],
  ])
  rows[6] = [2400, 3600, 7200, [event('Safari', 2400)]]
  const grown = await syncScreenTime({
    root,
    publish: true,
    client: store.client,
    ...fixture(rows),
    now: new Date(now.getTime() + 7_200_000),
  })
  assert.equal(grown.changed, true)
  assert.equal(grown.snapshot.days.at(-1).seconds, 2400)
  assert.equal(store.writes.length, 3)
})

test('the launch agent runs every hour at minute 50', () => {
  const plist = launchAgentPlist({
    node: '/n',
    script: '/s',
    cwd: '/c',
    log: '/l',
  })
  assert.match(plist, new RegExp(`<key>Label</key><string>${LABEL}</string>`))
  assert.match(
    plist,
    /<key>StartCalendarInterval<\/key><dict>\s*<key>Minute<\/key><integer>50<\/integer>\s*<\/dict>/
  )
  assert.ok(!plist.includes('<key>Hour</key>'))
  assert.match(plist, /<string>--publish<\/string>/)
})
