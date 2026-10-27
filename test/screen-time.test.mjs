import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
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
const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

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

test('failed sync retains the previous file and releases the lock for a later retry', async (t) => {
  const root = await sandbox(t)
  await mkdir(join(root, 'public/data'), { recursive: true })
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

test('daily publishing excludes staged user edits, retries a data-only commit, and refuses unrelated commits', async (t) => {
  const directory = await sandbox(t)
  const remote = join(directory, 'remote.git')
  const root = join(directory, 'working')
  git(directory, 'init', '--bare', remote)
  await mkdir(root)
  git(root, 'init', '-b', 'main')
  git(root, 'config', 'user.name', 'Screen time test')
  git(root, 'config', 'user.email', 'screen-time@example.invalid')
  await writeFile(join(root, 'author.txt'), 'original')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'initial')
  git(root, 'remote', 'add', 'origin', remote)
  git(root, 'push', '-u', 'origin', 'main')
  await writeFile(join(root, 'author.txt'), 'user edit')
  git(root, 'add', 'author.txt')
  await syncScreenTime({ root, publish: true, ...fixture() })
  assert.equal(
    git(root, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'),
    SNAPSHOT_PATH
  )
  assert.equal(git(root, 'diff', '--cached', '--name-only'), 'author.txt')
  assert.equal(git(root, 'show', 'HEAD:author.txt'), 'original')
  // An interrupted push leaves a valid data-only commit; the next run can deliver it.
  await writeFile(join(root, SNAPSHOT_PATH), 'pending')
  git(root, 'commit', '--only', '-m', 'pending data', '--', SNAPSHOT_PATH)
  await syncScreenTime({ root, publish: true, ...fixture() })
  assert.equal(git(root, 'rev-parse', 'HEAD'), git(remote, 'rev-parse', 'main'))
  git(root, 'commit', '-m', 'unrelated user commit')
  const old = await readFile(join(root, SNAPSHOT_PATH), 'utf8')
  await assert.rejects(
    syncScreenTime({ root, publish: true, ...fixture(newDay()) }),
    /unrelated commits/
  )
  assert.equal(await readFile(join(root, SNAPSHOT_PATH), 'utf8'), old)
  assert.notEqual(
    git(root, 'rev-parse', 'HEAD'),
    git(remote, 'rev-parse', 'main')
  )

  // A merge can introduce an unrelated file even when every branch commit is data-only.
  git(root, 'push', 'origin', 'main')
  git(root, 'switch', '-c', 'data-branch')
  await writeFile(join(root, SNAPSHOT_PATH), 'branch data')
  git(root, 'commit', '--only', '-m', 'branch data', '--', SNAPSHOT_PATH)
  git(root, 'switch', 'main')
  git(root, 'merge', '--no-ff', '--no-commit', 'data-branch')
  await writeFile(join(root, 'merge-only.txt'), 'unrelated merge resolution')
  git(root, 'add', 'merge-only.txt')
  git(root, 'commit', '-m', 'merge with extra change')
  assert.equal(
    git(root, 'log', '--format=', '--name-only', 'origin/main..HEAD'),
    SNAPSHOT_PATH
  )
  const merged = await readFile(join(root, SNAPSHOT_PATH), 'utf8')
  await assert.rejects(
    syncScreenTime({ root, publish: true, ...fixture(newDay()) }),
    /unrelated commits/
  )
  assert.equal(await readFile(join(root, SNAPSHOT_PATH), 'utf8'), merged)
  assert.notEqual(
    git(root, 'rev-parse', 'HEAD'),
    git(remote, 'rev-parse', 'main')
  )
})

test('an hourly rerun without new activity rewrites and publishes nothing', async (t) => {
  const root = await sandbox(t)
  const first = await syncScreenTime({ root, ...fixture() })
  assert.equal(first.changed, true)
  const before = await readFile(join(root, SNAPSHOT_PATH), 'utf8')
  const later = await syncScreenTime({
    root,
    ...fixture(),
    now: new Date(now.getTime() + 3_600_000),
  })
  assert.equal(later.changed, false)
  assert.equal(later.snapshot.updatedAt, first.snapshot.updatedAt)
  assert.equal(await readFile(join(root, SNAPSHOT_PATH), 'utf8'), before)
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
    ...fixture(rows),
    now: new Date(now.getTime() + 7_200_000),
  })
  assert.equal(grown.changed, true)
  assert.equal(grown.snapshot.days.at(-1).seconds, 2400)
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
