import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collageImages,
  dayDistance,
  defaultTravelMode,
  findBetweenMarks,
  formatDateRange,
  formatDayLabel,
  formatKilometers,
  formatStopTime,
  getReadingOffset,
  routeSummary,
  xhsSearchUrl,
  todayInTripZone,
  tripDistance,
  tripMapData,
  tripStatus,
  tripTotals,
  yearColors,
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

test('a day counts the legs leaving it, and the trip adds up its days', () => {
  assert.deepEqual(trip.days.map(dayDistance), [2000, 0])
  assert.equal(tripDistance(trip), 2000)
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
  assert.equal(
    xhsSearchUrl('全季酒店(观音桥店)'),
    'https://www.xiaohongshu.com/search_result/?keyword=%E5%85%A8%E5%AD%A3%E9%85%92%E5%BA%97(%E8%A7%82%E9%9F%B3%E6%A1%A5%E5%BA%97)'
  )
})

test('year colours follow the years in order, so adding a newer one keeps the rest', () => {
  const before = yearColors([2026, 2024, 2026])
  assert.deepEqual([...before.keys()], [2024, 2026])
  const after = yearColors([2024, 2026, 2027])
  assert.equal(after.get(2024), before.get(2024))
  assert.equal(after.get(2026), before.get(2026))
  assert.equal(new Set(after.values()).size, 3)
})

test('a leg line names the service, the lines or the mode, with its distance', () => {
  const flight = routeSummary({
    mode: 'flight',
    distance: 1_188_316,
    duration: 8700,
    service: { number: 'PN6458', depart: '22:00', arrive: '00:25' },
  })
  assert.equal(flight.text, 'PN6458 · 22:00–00:25 · 1,188 公里')
  assert.equal(flight.icon, 'i-ri-plane-line')
  assert.equal(
    routeSummary({
      mode: 'transit',
      distance: 26_000,
      duration: 5040,
      transit: { fare: '7元', lines: [{ name: '9号线' }, { name: '10号线' }] },
    }).text,
    '9号线 → 10号线 · 7元 · 1 小时 24 分钟 · 26 公里'
  )
  assert.equal(
    routeSummary({ mode: 'taxi', distance: 8807, duration: 1760 }).text,
    '打车 · 29 分钟 · 8.8 公里'
  )
  assert.equal(
    routeSummary({ mode: 'drive', distance: 3000, straight: true }).text,
    '开车 · 直线约 3 公里'
  )
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

test('map data numbers stops within each day and keeps legs with their day', () => {
  const data = tripMapData(
    '2026-11-06',
    trip,
    '#123456',
    (photo) => `t/${photo}`
  )
  assert.deepEqual(
    data.stops.map(({ index, day, number, name, photo }) => [
      index,
      day,
      number,
      name,
      photo,
    ]),
    [
      [0, 0, 1, 'A', 't/a1'],
      [1, 0, 2, 'B', undefined],
      [2, 1, 1, 'A', 't/a1'],
    ]
  )
  assert.deepEqual(
    data.legs.map(({ from, day, mode }) => [from, day, mode]),
    [
      [0, 0, 'drive'],
      [1, 0, 'drive'],
    ]
  )
  assert.equal(data.color, '#123456')
})

test('reading offset catches up to the last stop at the bottom of the panel', () => {
  const offset = getReadingOffset({
    end: 1950,
    maxScroll: 1200,
    readingLine: 300,
    scrollTop: 1200,
    viewport: 800,
  })
  assert.equal(offset, 1950)
  assert.deepEqual(findBetweenMarks([100, 400, 900], 50), {
    index: -1,
    fraction: 0,
  })
  assert.deepEqual(findBetweenMarks([100, 400, 900], 250), {
    index: 0,
    fraction: 0.5,
  })
  assert.deepEqual(findBetweenMarks([100, 400, 900], 950), {
    index: 1,
    fraction: 1,
  })
  assert.equal(defaultTravelMode([106.5, 29.5], [106.505, 29.5]), 'walk')
  assert.equal(defaultTravelMode([106.5, 29.5], [106.7, 29.5]), 'drive')
})
