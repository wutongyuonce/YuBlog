import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildTimeline,
  drawnRatio,
  dwellFor,
  pointAlong,
} from '../src/utils/trip-replay.ts'

// 两天三站，前两段各有路径；第二段跨天，终点与第三站重合。
const trip = {
  id: 't',
  title: 'T',
  dates: '',
  color: '#000',
  year: 2026,
  stops: [
    { name: 'A', coordinates: [106.5, 29.5], index: 0, day: 0, number: 1 },
    { name: 'B', coordinates: [106.51, 29.5], index: 1, day: 0, number: 2 },
    { name: 'C', coordinates: [106.51, 29.51], index: 2, day: 1, number: 1 },
  ],
  legs: [
    {
      from: 0,
      day: 0,
      mode: 'walk',
      path: [
        [106.5, 29.5],
        [106.505, 29.5],
        [106.51, 29.5],
      ],
    },
    {
      from: 1,
      day: 0,
      mode: 'flight',
      path: [
        [106.51, 29.5],
        [106.51, 29.51],
      ],
    },
  ],
}

test('each day opens, each stop dwells, then travels its leg along the joined path', () => {
  const timeline = buildTimeline(trip, false)
  assert.deepEqual(
    timeline.steps.map((step) => `${step.kind}:${step.stop}`),
    ['day:0', 'dwell:0', 'travel:0', 'dwell:1', 'travel:1', 'day:2', 'dwell:2']
  )
  assert.deepEqual(
    timeline.steps
      .filter((step) => step.kind === 'travel')
      .map((step) => step.mode),
    ['walk', 'flight']
  )
  // 重复的衔接点只保留一次。
  assert.equal(timeline.path.length, 4)
  const [, , firstLeg, secondStop, secondLeg, , lastStop] = timeline.steps
  assert.equal(firstLeg.from, 0)
  assert.equal(secondStop.at, firstLeg.to)
  assert.equal(secondLeg.from, firstLeg.to)
  assert.equal(lastStop.at, timeline.length)
  for (let i = 1; i < timeline.steps.length; i++) {
    const previous = timeline.steps[i - 1]
    assert.equal(timeline.steps[i].start, previous.start + previous.duration)
  }
  assert.equal(timeline.total, lastStop.start + lastStop.duration)
})

test('reduced motion skips the travel animation', () => {
  const timeline = buildTimeline(trip, true)
  assert.deepEqual(
    timeline.steps.map((step) => step.kind),
    ['day', 'dwell', 'dwell', 'day', 'dwell']
  )
})

test('a stop stays long enough for each photo to show once', () => {
  assert.equal(dwellFor(0), 3000)
  assert.equal(dwellFor(5), 7500)
  const timeline = buildTimeline(trip, false, (index) => (index === 1 ? 4 : 0))
  const dwell = timeline.steps.find(
    (step) => step.kind === 'dwell' && step.stop === 1
  )
  assert.equal(dwell.duration, 6000)
})

test('drawn progress follows map length, so the line head stays on the marker', () => {
  // 由赤道向北到 60°：墨卡托越往北拉得越长，地面走了一半时图上还没到一半。
  const north = buildTimeline(
    {
      ...trip,
      stops: [
        { name: 'S', coordinates: [100, 0], index: 0 },
        { name: 'N', coordinates: [100, 60], index: 1 },
      ],
      legs: [
        {
          from: 0,
          path: [
            [100, 0],
            [100, 30],
            [100, 60],
          ],
        },
      ],
    },
    false
  )
  assert.equal(drawnRatio(north, 0), 0)
  assert.equal(drawnRatio(north, north.length), 1)
  // 墨卡托里 30° 约在 0–60° 的 42% 处。
  assert.ok(Math.abs(drawnRatio(north, north.cumulative[1]) - 0.417) < 0.01)
})

test('points along the path interpolate and clamp at both ends', () => {
  const { path, cumulative, length } = buildTimeline(trip, false)
  assert.deepEqual(pointAlong(path, cumulative, -1), path[0])
  assert.deepEqual(pointAlong(path, cumulative, length + 1), path.at(-1))
  const [lng, lat] = pointAlong(path, cumulative, cumulative[1] / 2)
  assert.ok(Math.abs(lng - 106.5025) < 1e-9 && lat === 29.5)
})
