import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  formatScreenTime,
  parseScreenTime,
  screenTimeDayLabel,
  screenTimePeriods,
} from '../src/utils/screen-time.js'
import {
  fetchScreenTime,
  SNAPSHOT_PATH,
  syncScreenTime,
} from '../scripts/sync-screen-time.mjs'

const now = new Date('2026-10-27T12:00:00Z')
const host = 'test-machine'
const fixture = (
  results = Array.from({ length: 7 }, () => [1800.4, 3600, 7200])
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

// Beijing midnight is 16:00 UTC even on leap days, independent of the process timezone.
test('seven calendar days end at the capture time and roll over at Beijing midnight', () => {
  const periods = screenTimePeriods(new Date('2024-02-29T16:00:01Z'))
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
  assert.equal(
    screenTimeDayLabel('2024-02-29', new Date('2024-02-29T16:00:01Z')),
    '2 月 29 日活跃'
  )
  assert.equal(
    screenTimeDayLabel('2024-03-01', new Date('2024-02-29T16:00:01Z')),
    '今天活跃'
  )
})

test('only daily active seconds are published; missing collection differs from recorded zero', async () => {
  const options = fixture([
    [0, 0, 0],
    [0, 0, 600],
    [0, 600, 600],
    ...Array.from({ length: 4 }, () => [1800.4, 3600, 7200]),
  ])
  const snapshot = await fetchScreenTime(options)
  assert.deepEqual(
    snapshot.days.map((day) => day.seconds),
    [null, null, 0, 1800, 1800, 1800, 1800]
  )
  assert.deepEqual(Object.keys(snapshot), ['timeZone', 'updatedAt', 'days'])
  assert.deepEqual(Object.keys(snapshot.days[0]), ['date', 'seconds'])
  assert.equal(options.calls.length, 2)
  const query = JSON.parse(options.calls[1].body)
  assert.equal(
    query.timeperiods[0],
    '2026-10-20T16:00:00.000Z/2026-10-21T16:00:00.000Z'
  )
  assert.equal(query.timeperiods.at(-1).split('/')[1], now.toISOString())
  assert.match(
    query.query.join(''),
    /filter_period_intersect\(win, filter_keyvals\(afk, "status", \["not-afk"\]\)\)/
  )
  assert.match(query.query.join(''), /query_bucket\("window-local"\)/)
  assert.ok(!query.query.join('').includes('window-other'))
  assert.match(query.query.at(-1), /RETURN = \[sum_durations/)
  assert.equal(formatScreenTime(null), '暂无记录')
  assert.equal(formatScreenTime(0), '0 分钟')
  assert.equal(formatScreenTime(20), '不到 1 分钟')
  assert.equal(formatScreenTime(3660), '1 小时 1 分钟')
  assert.equal(formatScreenTime(3600), '1 小时')
  const safe = parseScreenTime({
    ...snapshot,
    title: 'private',
    days: snapshot.days.map((day) => ({ ...day, app: 'private' })),
  })
  assert.ok(!JSON.stringify(safe).includes('private'))
})

test('partial, negative, impossible, or nonnumeric upstream data fails instead of publishing false totals', async () => {
  for (const row of [
    [-1, 100, 100],
    ['60', 100, 100],
    [200, 100, 100],
    [90000, 90000, 90000],
    [1, 2],
  ]) {
    await assert.rejects(
      fetchScreenTime(fixture(Array.from({ length: 7 }, () => row))),
      /duration/
    )
  }
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
  const snapshot = await syncScreenTime({ root, ...fixture() })
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
    syncScreenTime({ root, publish: true, ...fixture() }),
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
    syncScreenTime({ root, publish: true, ...fixture() }),
    /unrelated commits/
  )
  assert.equal(await readFile(join(root, SNAPSHOT_PATH), 'utf8'), merged)
  assert.notEqual(
    git(root, 'rev-parse', 'HEAD'),
    git(remote, 'rev-parse', 'main')
  )
})
