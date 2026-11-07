import assert from 'node:assert/strict'
import test from 'node:test'
import { placeDropdownPanel } from '../src/utils/nav-dropdown-position.js'

const nav = { boundLeft: 16, boundRight: 374, originLeft: 20 }

test('panel centres under its trigger when there is room', () => {
  const left = placeDropdownPanel({
    ...nav,
    triggerLeft: 150,
    triggerWidth: 60,
    panelWidth: 200,
  })
  // 中心 180 → 左缘 80，相对包含块 60
  assert.equal(left, 60)
})

test('panel near the right edge stays inside the nav box', () => {
  const left = placeDropdownPanel({
    ...nav,
    triggerLeft: 320,
    triggerWidth: 50,
    panelWidth: 200,
  })
  assert.equal(left + nav.originLeft + 200, nav.boundRight)
})

test('panel near the left edge stays inside the nav box', () => {
  const left = placeDropdownPanel({
    ...nav,
    triggerLeft: 20,
    triggerWidth: 50,
    panelWidth: 200,
  })
  assert.equal(left + nav.originLeft, nav.boundLeft)
})

test('panel wider than the nav aligns to its left edge', () => {
  const left = placeDropdownPanel({
    ...nav,
    triggerLeft: 200,
    triggerWidth: 50,
    panelWidth: 500,
  })
  assert.equal(left + nav.originLeft, nav.boundLeft)
})
