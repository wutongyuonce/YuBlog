import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collageImages,
  formatDateRange,
  formatDayLabel,
  formatKilometers,
  formatStopTime,
  todayInTripZone,
  tripMapData,
  tripStatus,
  tripTotals,
  yearColor,
} from '../src/utils/trips.js'

const stop = (name, extra = {}) => ({
  name,
  coordinates: [106.5, 29.5],
  photos: [],
  ...extra,
})
const route = (distance) => ({
  mode: 'drive',
  distance,
  path: [
    [106.5, 29.5],
    [106.6, 29.6],
  ],
})

const trip = {
  title: '重庆',
  start: '2026-11-06',
  end: '2026-11-08',
  cover: [],
  days: [
    {
      date: '2026-11-06',
      stops: [
        stop('A', { route: route(1200), photos: ['a1', 'a2'] }),
        stop('B', { route: route(800) }),
      ],
    },
    { date: '2026-11-08', stops: [stop('A', { photos: ['a1', 'c1'] })] },
  ],
}

test('a trip is a plan until its last day has passed in Shanghai', () => {
  assert.equal(tripStatus('2026-11-08', '2026-11-08'), 'plan')
  assert.equal(tripStatus('2026-11-08', '2026-11-09'), 'record')
  // 上海已是 11 月 9 日，UTC 仍是 8 日。
  assert.equal(todayInTripZone(new Date('2026-11-08T16:30:00Z')), '2026-11-09')
})

test('totals count calendar days, distinct places and every leg', () => {
  assert.deepEqual(tripTotals([trip, trip]), {
    count: 2,
    days: 6,
    places: 4,
    distance: 4000,
  })
  assert.equal(formatKilometers(2000), '2')
  assert.equal(formatKilometers(9460), '9.5')
  assert.equal(formatKilometers(19_997_400), '19,997')
})

test('date labels', () => {
  assert.equal(formatDateRange('2026-11-06', '2026-11-08'), '11月6日 – 11月8日')
  assert.equal(formatDateRange('2026-11-06', '2026-11-06'), '11月6日')
  assert.equal(
    formatDateRange('2025-12-30', '2026-01-02'),
    '2025年12月30日 – 2026年1月2日'
  )
  assert.equal(formatDayLabel('2026-11-06'), '11月6日 周五')
  assert.equal(
    formatStopTime({ start: '09:00', end: '11:00' }),
    '09:00 – 11:00'
  )
  assert.equal(formatStopTime({ start: '22:00' }), '22:00 起')
  assert.equal(formatStopTime({ end: '00:25' }), '至 00:25')
  assert.equal(formatStopTime(undefined), '')
})

test('year colours are fixed per year, so new years never recolour old ones', () => {
  assert.deepEqual([2024, 2025, 2026].map(yearColor), [
    '#3b82f6',
    '#8b5cf6',
    '#f59e0b',
  ])
  assert.equal(yearColor(2030), yearColor(2024))
})

test('collage prefers covers, then distinct stop photos, up to three', () => {
  const key = (image) => image
  assert.deepEqual(collageImages(trip, key), ['a1', 'a2', 'c1'])
  assert.deepEqual(collageImages({ ...trip, cover: ['c1'] }, key), [
    'c1',
    'a1',
    'a2',
  ])
  assert.deepEqual(
    collageImages({ cover: [], days: [{ stops: [stop('X')] }] }, key),
    []
  )
})

test('map data numbers stops across days and keeps legs from their stop', () => {
  const data = tripMapData('2026-11-06', trip)
  assert.deepEqual(
    data.stops.map(({ index, name }) => [index, name]),
    [
      [0, 'A'],
      [1, 'B'],
      [2, 'A'],
    ]
  )
  assert.deepEqual(
    data.legs.map(({ from }) => from),
    [0, 1]
  )
  assert.equal(data.color, yearColor(2026))
})
