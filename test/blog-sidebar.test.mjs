import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getSidebarBottomGap,
  shouldLockSidebar,
} from '../src/utils/blog-sidebar.js'

test('sidebar bottom gap follows recent writing height and keeps a minimum', () => {
  assert.equal(getSidebarBottomGap(280), 260)
  assert.equal(getSidebarBottomGap(20), 4)
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
    shouldLockSidebar({ ...metrics, viewportWidth: 1099, sidebarHeight: 900 }),
    false
  )
})
