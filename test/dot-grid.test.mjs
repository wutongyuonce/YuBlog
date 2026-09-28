import assert from 'node:assert/strict'
import test from 'node:test'
import { getDotGrid, MAX_DOT_POINTS } from '../src/utils/dot-grid.js'

test('normal laptop view keeps the original spacing and point layout', () => {
  const grid = getDotGrid(1440, 900)
  assert.equal(grid.spacing, 15)
  assert.equal(grid.columns * grid.rows, 6076)
})

test('edge-covering grids never exceed the per-frame point bound', () => {
  for (const [width, height] of [
    [1920, 1080],
    [3840, 2160],
    [7680, 4320],
    [7680, 1080],
    [1080, 7680],
  ]) {
    const { spacing, columns, rows } = getDotGrid(width, height)
    assert.ok(columns * rows <= MAX_DOT_POINTS, `${width}×${height}`)
    assert.ok((columns - 0.5) * spacing >= width, 'grid covers right edge')
    assert.ok((rows - 0.5) * spacing >= height, 'grid covers bottom edge')
  }
})
