import assert from 'node:assert/strict'
import test from 'node:test'
import { sortMediaItems, mediaStats } from '../src/utils/media-hub.js'

test('todo first, dated done before undated, undated by title', () => {
  const sorted = sortMediaItems([
    { status: 'done', title: '乙', date: '2026-01-01' },
    { status: 'todo', title: '待看甲' },
    { status: 'done', title: '甲' },
    { status: 'done', title: '丙', date: '2026-11-01' },
  ])
  assert.deepEqual(
    sorted.map((i) => i.title),
    ['待看甲', '丙', '乙', '甲']
  )
})

test('stats use Shanghai calendar month/year', () => {
  const now = new Date('2026-11-06T12:00:00+08:00')
  const stats = mediaStats(
    [
      { status: 'todo' },
      { status: 'done', date: '2026-11-03' },
      { status: 'done', date: '2026-01-01' },
      { status: 'done' },
    ],
    now
  )
  assert.deepEqual(stats, { todo: 1, doneMonth: 1, doneYear: 2, total: 4 })
})
