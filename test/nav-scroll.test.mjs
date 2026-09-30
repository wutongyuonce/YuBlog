import assert from 'node:assert/strict'
import test from 'node:test'
import {
  predictNavVisibility,
  updateNavScroll,
  updateNavVisibility,
} from '../src/utils/nav-scroll.js'

const start = { y: 0, direction: 0, travel: 0, hidden: false }

test('scrolling keeps the top accessible and waits for deliberate travel', () => {
  let state = updateNavScroll(start, 75)
  assert.equal(state.hidden, false)
  state = updateNavScroll(state, 90)
  assert.equal(state.hidden, false)
  state = updateNavScroll(state, 94)
  assert.equal(state.hidden, true)
  state = updateNavScroll(state, 92)
  assert.equal(
    state.hidden,
    true,
    'small upward jitter must not reveal the bar'
  )
  state = updateNavScroll(state, 76)
  assert.equal(state.hidden, false)
})

test('upward travel reveals navigation; menu focus pins it and resets travel', () => {
  let state = updateNavScroll(start, 400)
  assert.equal(state.hidden, true)
  state = updateNavScroll(state, 380)
  assert.equal(state.hidden, false)
  state = updateNavScroll(state, 500, true)
  assert.equal(state.hidden, false)
  state = updateNavScroll(state, 501)
  assert.equal(state.hidden, false, 'closing a menu cannot immediately hide it')
  state = updateNavScroll(state, 520)
  assert.equal(state.hidden, true)
})

test('overscroll cannot strand navigation offscreen', () => {
  const state = updateNavScroll(updateNavScroll(start, 400), -20)
  assert.equal(state.y, 0)
  assert.equal(state.hidden, false)
})

test('nearby anchor predictions retain accumulated travel without consuming it', () => {
  assert.equal(updateNavVisibility(400, true), false)
  assert.equal(updateNavVisibility(414), false)
  assert.equal(predictNavVisibility(420), true, '14 + 6px hides the bar')
  assert.equal(
    predictNavVisibility(414),
    false,
    'preview does not change state'
  )
  assert.equal(updateNavVisibility(420), true)
  assert.equal(updateNavVisibility(406), true)
  assert.equal(
    predictNavVisibility(400),
    false,
    'upward travel is retained too'
  )
  assert.equal(updateNavVisibility(400), false)
})
