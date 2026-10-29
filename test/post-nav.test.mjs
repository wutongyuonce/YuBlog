import assert from 'node:assert/strict'
import test from 'node:test'

import { getPostNeighbors } from '../src/utils/post-nav.ts'

/** Newest-first fixture matching getSortedPosts order. */
const sorted = [
  { id: 'c-new', title: 'C', href: '/blogs/c-new/' },
  { id: 'b-mid', title: 'B', href: '/blogs/b-mid/' },
  { id: 'a-old', title: 'A', href: '/blogs/a-old/' },
]

test('上一篇 is the older neighbor; 下一篇 is the newer neighbor', () => {
  const mid = getPostNeighbors(sorted, 'b-mid')
  assert.equal(mid.prev?.id, 'a-old')
  assert.equal(mid.next?.id, 'c-new')
  assert.equal(mid.index, 1)

  const newest = getPostNeighbors(sorted, 'c-new')
  assert.equal(newest.prev?.id, 'b-mid')
  assert.equal(newest.next, null)
  assert.equal(newest.index, 0)

  const oldest = getPostNeighbors(sorted, 'a-old')
  assert.equal(oldest.prev, null)
  assert.equal(oldest.next?.id, 'b-mid')
  assert.equal(oldest.index, 2)
})

test('unknown id yields empty neighbors', () => {
  const miss = getPostNeighbors(sorted, 'missing')
  assert.deepEqual(miss, { prev: null, next: null, index: -1 })
})

test('same-day id order matches localeCompare ascending in the sorted array', () => {
  // Already sorted like getSortedPosts: equal dates keep id ascending, so
  // 'alpha' sits above 'beta' (toward newer / earlier index).
  const sameDay = [
    { id: 'alpha', title: 'A', href: '/blogs/alpha/' },
    { id: 'beta', title: 'B', href: '/blogs/beta/' },
  ]
  const aroundAlpha = getPostNeighbors(sameDay, 'alpha')
  assert.equal(aroundAlpha.prev?.id, 'beta')
  assert.equal(aroundAlpha.next, null)
  const aroundBeta = getPostNeighbors(sameDay, 'beta')
  assert.equal(aroundBeta.prev, null)
  assert.equal(aroundBeta.next?.id, 'alpha')
})
