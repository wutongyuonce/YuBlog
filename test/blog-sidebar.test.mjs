import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BLOG_SIDEBAR_BREAKPOINT,
  getSidebarBottomGap,
  shouldStickSidebar,
} from '../src/utils/blog-sidebar.js'

const metrics = {
  viewportWidth: 1440,
  sidebarHeight: 900,
  viewportHeight: 800,
  headerHeight: 56,
  columnStart: 80,
  sidebarBottomGap: 215,
}

test('sidebar keeps the original gap derived from the recent-writing block', () => {
  assert.equal(getSidebarBottomGap(343), 215)
  assert.equal(getSidebarBottomGap(20), 4)
})

test('tall sidebar sticks at its original threshold without scroll-driven locking', () => {
  assert.equal(shouldStickSidebar(metrics), true)
  assert.equal(
    shouldStickSidebar({
      ...metrics,
      sidebarHeight:
        metrics.viewportHeight - metrics.columnStart - metrics.sidebarBottomGap,
    }),
    false
  )
})

test('sidebar stays in normal flow without measurements or on narrow layouts', () => {
  assert.equal(shouldStickSidebar({ ...metrics, headerHeight: null }), false)
  assert.equal(
    shouldStickSidebar({ ...metrics, sidebarBottomGap: null }),
    false
  )
  assert.equal(
    shouldStickSidebar({
      ...metrics,
      viewportWidth: BLOG_SIDEBAR_BREAKPOINT,
    }),
    false
  )
})
