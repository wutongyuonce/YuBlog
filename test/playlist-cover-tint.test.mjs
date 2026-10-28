import assert from 'node:assert/strict'
import test from 'node:test'
import { tintFromRgba } from '../src/utils/playlist-cover-tint.js'

const rgba = (...pixels) => Uint8ClampedArray.from(pixels.flat())

test('averages midtone pixels and lifts them into glass wash channels', () => {
  const data = rgba(
    [200, 80, 140, 255],
    [180, 60, 120, 255],
    [10, 10, 10, 255], // near-black skipped
    [250, 250, 250, 255], // near-white skipped
    [190, 70, 130, 0] // transparent skipped
  )
  const tint = tintFromRgba(data)
  assert.deepEqual(tint, { tint: '225 83 154', soft: '209 126 167' })
})

test('falls back to opaque average when only extremes remain', () => {
  const data = rgba([8, 4, 4, 255], [250, 248, 246, 255])
  const tint = tintFromRgba(data)
  assert.ok(tint)
  assert.match(tint.tint, /^\d+ \d+ \d+$/)
  const [r] = tint.tint.split(' ').map(Number)
  assert.ok(r > 8, 'dark samples should be lifted for a visible glass wash')
})

test('rejects empty or malformed buffers', () => {
  assert.equal(tintFromRgba(null), null)
  assert.equal(tintFromRgba(Uint8ClampedArray.from([])), null)
  assert.equal(tintFromRgba(Uint8ClampedArray.from([1, 2, 3])), null)
  assert.equal(tintFromRgba(rgba([0, 0, 0, 0], [255, 255, 255, 0])), null)
})
