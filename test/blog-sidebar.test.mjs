import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BLOG_SIDEBAR_BREAKPOINT,
  MIN_SIDEBAR_BOTTOM_GAP,
  SIDEBAR_BOTTOM_GAP_REDUCTION,
  SIDEBAR_BOTTOM_GAP_SCALE,
  getSidebarBottomGap,
  shouldLockSidebar,
} from '../src/utils/blog-sidebar.js'

test('sidebar bottom gap follows source height and keeps a minimum', () => {
  assert.equal(
    getSidebarBottomGap(280),
    Math.round((280 - SIDEBAR_BOTTOM_GAP_REDUCTION) * SIDEBAR_BOTTOM_GAP_SCALE)
  )
  assert.equal(getSidebarBottomGap(20), MIN_SIDEBAR_BOTTOM_GAP)
})

test('sidebar locks only after the tall sidebar reaches its bottom threshold', () => {
  const metrics = {
    viewportWidth: 1440,
    sidebarHeight: 900,
    viewportHeight: 800,
    headerHeight: 56,
    columnTop: 80,
    columnBottom: 760,
    sidebarBottomGap: 100,
  }

  assert.equal(shouldLockSidebar(metrics), false)
  assert.equal(shouldLockSidebar({ ...metrics, columnBottom: 700 }), true)
})

test('sidebar stays unlocked when its header or measurement anchor is missing', () => {
  const metrics = {
    viewportWidth: 1440,
    sidebarHeight: 900,
    viewportHeight: 800,
    headerHeight: 56,
    columnTop: 80,
    columnBottom: 700,
    sidebarBottomGap: 100,
  }

  assert.equal(shouldLockSidebar({ ...metrics, headerHeight: null }), false)
  assert.equal(shouldLockSidebar({ ...metrics, sidebarBottomGap: null }), false)
})

test('sidebar stays in normal flow when it fits or the layout is narrow', () => {
  const metrics = {
    viewportWidth: 1440,
    sidebarHeight: 400,
    viewportHeight: 800,
    headerHeight: 56,
    columnTop: 80,
    columnBottom: 500,
    sidebarBottomGap: 100,
  }

  assert.equal(shouldLockSidebar(metrics), false)
  assert.equal(
    shouldLockSidebar({
      ...metrics,
      viewportWidth: BLOG_SIDEBAR_BREAKPOINT,
      sidebarHeight: 900,
    }),
    false
  )
})
