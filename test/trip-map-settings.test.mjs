import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_MAP_SETTINGS,
  isDarkMapStyle,
  parseMapSettings,
  pitchAtZoom,
  resolveMapStyle,
} from '../src/utils/trip-map-settings.js'

test('stored settings are validated and fall back to the defaults', () => {
  assert.deepEqual(parseMapSettings(null), DEFAULT_MAP_SETTINGS)
  assert.deepEqual(parseMapSettings('{oops'), DEFAULT_MAP_SETTINGS)
  assert.deepEqual(parseMapSettings('{"style":"positron","tilt":false}'), {
    style: 'positron',
    tilt: false,
  })
  assert.deepEqual(parseMapSettings('{"style":"mapbox","tilt":"yes"}'), {
    style: DEFAULT_MAP_SETTINGS.style,
    tilt: DEFAULT_MAP_SETTINGS.tilt,
  })
})

test('the automatic style follows the site theme; others stay fixed', () => {
  assert.equal(resolveMapStyle({ style: 'auto' }, false), 'liberty')
  assert.equal(resolveMapStyle({ style: 'auto' }, true), 'dark')
  assert.equal(resolveMapStyle({ style: 'positron' }, true), 'positron')
  assert.deepEqual(
    ['liberty', 'bright', 'positron', 'dark', 'fiord'].map(isDarkMapStyle),
    [false, false, false, true, true]
  )
})

test('3D tilt is flat far out, never decreases as you zoom in, and is capped', () => {
  assert.equal(pitchAtZoom(2), 0)
  assert.equal(pitchAtZoom(4), 0)
  const zooms = Array.from({ length: 41 }, (_, i) => 2 + i * 0.4)
  const pitches = zooms.map(pitchAtZoom)
  assert.ok(pitches.every((pitch, i) => i === 0 || pitch >= pitches[i - 1]))
  assert.ok(pitches.some((pitch) => pitch > 0 && pitch < 55))
  assert.equal(pitchAtZoom(18), 55)
})
