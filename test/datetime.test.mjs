import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatPostListDate,
  formatPostMetaDate,
  getSiteCalendarParts,
  sameSiteCalendarDate,
} from '../src/utils/post-meta-date.js'

test('formats post-meta dates with spaces between digits and CJK', () => {
  assert.equal(
    formatPostMetaDate('2026-06-21T00:00:00+08:00'),
    '2026 年 6 月 21 日'
  )
  assert.equal(
    formatPostMetaDate('2026-12-01T12:00:00+08:00'),
    '2026 年 12 月 1 日'
  )
})

test('uses Asia/Shanghai calendar parts across UTC midnight', () => {
  // 2026-06-20 23:30 UTC is already 2026-06-21 in Shanghai.
  assert.deepEqual(getSiteCalendarParts('2026-06-20T23:30:00Z'), {
    year: 2026,
    month: 6,
    day: 21,
  })
  assert.equal(formatPostMetaDate('2026-06-20T23:30:00Z'), '2026 年 6 月 21 日')
})

test('sameSiteCalendarDate ignores clock time on the same Shanghai day', () => {
  assert.equal(
    sameSiteCalendarDate(
      '2026-06-21T01:00:00+08:00',
      '2026-06-21T23:59:00+08:00'
    ),
    true
  )
  assert.equal(
    sameSiteCalendarDate(
      '2026-06-21T00:00:00+08:00',
      '2026-06-22T00:00:00+08:00'
    ),
    false
  )
})

test('rejects invalid dates', () => {
  assert.throws(() => formatPostMetaDate('not-a-date'), /Invalid Date/)
  assert.throws(() => sameSiteCalendarDate('bad', '2026-01-01'), /Invalid Date/)
})

test('formats short list dates as YYYY-MM-DD in Asia/Shanghai', () => {
  assert.equal(formatPostListDate('2026-06-21T00:00:00+08:00'), '2026-06-21')
  assert.equal(formatPostListDate('2026-06-20T23:30:00Z'), '2026-06-21')
  assert.equal(formatPostListDate('2026-12-01T12:00:00+08:00'), '2026-12-01')
})
