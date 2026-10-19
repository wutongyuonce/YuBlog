import assert from 'node:assert/strict'
import test from 'node:test'
import { clampSlideIndex } from '../src/utils/image-lightbox-gallery.js'

test('clampSlideIndex stays inside [0, total)', () => {
  assert.equal(clampSlideIndex(-1, 5), 0)
  assert.equal(clampSlideIndex(0, 5), 0)
  assert.equal(clampSlideIndex(2, 5), 2)
  assert.equal(clampSlideIndex(9, 5), 4)
  assert.equal(clampSlideIndex(0, 0), 0)
  assert.equal(clampSlideIndex(3, 1), 0)
})
