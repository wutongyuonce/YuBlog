import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildWritingHeatmap,
  calendarKey,
  formatHeatmapLabel,
  levelForCount,
} from '../src/utils/blog-heatmap.js'

const entry = (date, title = '一篇', href = '/blogs/post/', words = 0) => ({
  date,
  title,
  href,
  words,
})

test('buckets a publication by its Shanghai calendar day', () => {
  assert.equal(calendarKey('2026-03-18T00:00:00Z'), '2026-03-18')
  assert.equal(calendarKey('2025-12-31T16:00:00Z'), '2026-01-01')
  assert.equal(formatHeatmapLabel('2026-03-18'), '2026年3月18日星期三')
})

test('caps the darkest cell at four posts', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(levelForCount), [0, 1, 2, 3, 4, 4])
})

test('distinct days retain one article apiece without needing a multi-post day', () => {
  const heatmap = buildWritingHeatmap(
    [entry('2026-03-18', '甲', '/a/'), entry('2026-03-19', '乙', '/b/')],
    new Date('2026-06-01T00:00:00+08:00')
  )
  const active = heatmap.years[0].weeks.flat().filter((cell) => cell.count > 0)
  assert.deepEqual(
    active.map(({ key, count }) => [key, count, heatmap.postsByDate[key]]),
    [
      ['2026-03-18', 1, [{ title: '甲', href: '/a/' }]],
      ['2026-03-19', 1, [{ title: '乙', href: '/b/' }]],
    ]
  )
})

test('merges posts that fall on the same Shanghai day', () => {
  const heatmap = buildWritingHeatmap(
    [
      entry('2026-03-17T16:30:00Z', '凌晨', '/a/'),
      entry('2026-03-18T02:00:00Z', '上午', '/b/'),
    ],
    new Date('2026-06-01T00:00:00+08:00')
  )
  const march = heatmap.years
    .find((year) => year.year === 2026)
    .weeks.flat()
    .find((cell) => cell.key === '2026-03-18')

  assert.equal(march.count, 2)
  assert.equal(march.level, 2)
  assert.deepEqual(heatmap.postsByDate['2026-03-18'], [
    { title: '凌晨', href: '/a/' },
    { title: '上午', href: '/b/' },
  ])
})

test('aligns a year to Monday and does not count padding days', () => {
  const heatmap = buildWritingHeatmap(
    [entry('2025-12-31T00:00:00Z', '跨年', '/old/')],
    new Date('2026-06-01T00:00:00+08:00')
  )
  const year = heatmap.years.find((item) => item.year === 2026)

  assert.equal(year.weeks.length, 53)
  assert.deepEqual(
    year.weeks[0].map((cell) => [cell.key, cell.inYear]),
    [
      ['2025-12-29', false],
      ['2025-12-30', false],
      ['2025-12-31', false],
      ['2026-01-01', true],
      ['2026-01-02', true],
      ['2026-01-03', true],
      ['2026-01-04', true],
    ]
  )
  assert.equal(year.total, 0)
  assert.equal(heatmap.years.find((item) => item.year === 2025).total, 1)
})

test('labels the week that contains the first of each month', () => {
  const year = buildWritingHeatmap(
    [entry('2026-01-02')],
    new Date('2026-06-01T00:00:00+08:00')
  ).years.find((item) => item.year === 2026)

  for (let month = 1; month <= 12; month += 1) {
    const column = year.weeks.findIndex((week) =>
      week.some((cell) => {
        const [, cellMonth, day] = cell.key.split('-').map(Number)
        return cell.inYear && day === 1 && cellMonth === month
      })
    )
    assert.equal(year.weekLabels[column], `${month}月`)
  }
})

test('offers every year from the first post through the current year', () => {
  const heatmap = buildWritingHeatmap(
    [entry('2025-12-21')],
    new Date('2026-06-01T00:00:00+08:00')
  )

  assert.deepEqual(
    heatmap.years.map((year) => year.year),
    [2025, 2026]
  )
  assert.equal(heatmap.selectedYear, 2026)
  assert.equal(heatmap.years[1].total, 0)
})

test('does not invent years before the blog started', () => {
  const heatmap = buildWritingHeatmap(
    [entry('2026-03-18')],
    new Date('2025-06-01T00:00:00+08:00')
  )

  assert.deepEqual(
    heatmap.years.map((year) => year.year),
    [2026]
  )
  assert.equal(heatmap.selectedYear, 2026)
})

test('returns nothing when there are no posts', () => {
  assert.equal(buildWritingHeatmap([]), null)
})

test('sums word counts on the Shanghai year, ignoring padding days', () => {
  const heatmap = buildWritingHeatmap(
    [
      entry('2025-06-01T00:00:00Z', '去年', '/old/', 400),
      entry('2025-12-31T16:00:00Z', '跨年', '/new-year/', 1200),
      entry('2026-03-17T16:30:00Z', '凌晨', '/a/', 50),
      entry('2026-03-18T02:00:00Z', '上午', '/b/', 800),
    ],
    new Date('2026-06-01T00:00:00+08:00')
  )

  assert.equal(heatmap.years.find((year) => year.year === 2025).words, 400)
  assert.equal(heatmap.years.find((year) => year.year === 2026).words, 2050)
})

test('rejects a word count that is not a non-negative integer', () => {
  assert.throws(
    () =>
      buildWritingHeatmap([entry('2026-03-18T00:00:00Z', '坏', '/bad/', 1.5)]),
    /Invalid word count/
  )
})

test('rejects missing words at the owning interface, not just the home caller', () => {
  assert.throws(
    () =>
      buildWritingHeatmap([
        { date: '2026-03-18', title: '缺失', href: '/missing/' },
      ]),
    /Missing rendered word count/
  )
})

test('keeps leap day and Monday alignment even when a year needs 54 weeks', () => {
  const year = buildWritingHeatmap(
    [entry('2012-02-29', '闰日', '/leap/', 9)],
    new Date('2012-12-31')
  ).years[0]
  assert.equal(year.weeks.length, 54)
  assert.equal(year.weeks.flat().filter((cell) => cell.inYear).length, 366)
  assert.equal(year.total, 1)
  assert.equal(year.activeDays, 1)
  assert.equal(year.words, 9)
})
