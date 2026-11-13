import assert from 'node:assert/strict'
import test from 'node:test'

import {
  calendarMonths,
  formatEntryDate,
  monthCells,
  monthPath,
  sortEntries,
} from '../src/utils/calendar.js'

test('a month grid starts on Monday and fills whole weeks', () => {
  // 2026 年 11 月 1 日是周日。
  const cells = monthCells('2026-11')
  assert.equal(cells.length % 7, 0)
  assert.deepEqual(
    cells.slice(0, 7).map((cell) => cell?.day),
    [undefined, undefined, undefined, undefined, undefined, undefined, 1]
  )
  assert.equal(cells.filter(Boolean).length, 30)
  assert.equal(monthCells('2028-02').filter(Boolean).length, 29)
})

test('months, paths and entry dates', () => {
  assert.deepEqual(
    calendarMonths([
      { date: '2026-11-10' },
      { date: '2025-03-01' },
      { date: '2026-11-02' },
    ]),
    ['2025-03', '2026-11']
  )
  assert.equal(monthPath('2026-03'), '/calendar/2026/03/')
  assert.equal(
    formatEntryDate({ date: '2026-11-10', time: '19:30' }),
    '11月10日 周二 · 19:30'
  )
})

test('the timeline puts newer days and later times first, untimed last', () => {
  const entry = (id, date, time) => ({ id, data: { date, time } })
  const sorted = sortEntries(
    [
      entry('a', '2026-11-09'),
      entry('b', '2026-11-10'),
      entry('c', '2026-11-10', '09:00'),
      entry('d', '2026-11-10', '19:30'),
    ],
    (item) => item.id
  )
  assert.deepEqual(
    sorted.map((item) => item.id),
    ['d', 'c', 'b', 'a']
  )
})
