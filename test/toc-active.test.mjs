import assert from 'node:assert/strict'
import test from 'node:test'

import { pickActiveHeadingIndex } from '../src/utils/toc-active.js'

const line = 80

test('keeps the parent while a visible child is still below the line', () => {
  // The screenshot: the h2 has landed under the header, its first h3 is on
  // screen but has not reached the click-landing line.
  assert.equal(pickActiveHeadingIndex([24, 148, 420], line, false), 0)
})

test('advances only after the next heading reaches the line', () => {
  assert.equal(pickActiveHeadingIndex([-40, 72, 420], line, false), 1)
})

test('does not skip ahead to a later heading just because it is on screen', () => {
  assert.equal(pickActiveHeadingIndex([20, 180, 320], line, false), 0)
})

test('returns to the parent when the child scrolls back below the line', () => {
  assert.equal(pickActiveHeadingIndex([12, 96], line, false), 0)
})

test('uses the first heading before any heading reaches the line', () => {
  assert.equal(pickActiveHeadingIndex([200, 480], line, false), 0)
})

test('uses the last heading at the bottom of a scrollable page', () => {
  assert.equal(pickActiveHeadingIndex([-800, -200, 160], line, true), 2)
})

test('does not treat a page that cannot scroll as the bottom', () => {
  assert.equal(pickActiveHeadingIndex([120, 280], line, false), 0)
})

test('returns -1 when there are no headings', () => {
  assert.equal(pickActiveHeadingIndex([], line, true), -1)
})
