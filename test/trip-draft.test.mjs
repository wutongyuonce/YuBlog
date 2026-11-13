import assert from 'node:assert/strict'
import test from 'node:test'

import { gcj02ToWgs84 } from '../src/utils/pitravel.mjs'
import { parseTripDraft } from '../src/utils/trip-draft.mjs'

const stop = (extra = {}) => ({
  name: '绿心公园',
  coordinates: [106.5, 29.6],
  ...extra,
})
const draft = (extra = {}) => ({
  title: ' 重庆周末 ',
  days: [
    {
      date: '2026-12-05',
      summary: '到达',
      stops: [
        stop({
          time: { start: '09:30' },
          photos: ['./a.jpg', 'https://cdn.example/b.jpg'],
          travel: 'train',
          travelMinutes: 12,
          service: { number: 'G1234', depart: '09:40' },
        }),
        stop({ name: '解放碑' }),
      ],
    },
    { date: '2026-12-06' },
  ],
  cover: ['/abs/cover.jpg'],
  ...extra,
})

test('a hand-written draft becomes the neutral import draft', () => {
  const result = parseTripDraft(draft(), '/notes/trip')
  assert.equal(result.title, '重庆周末')
  assert.deepEqual([result.start, result.end], ['2026-12-05', '2026-12-06'])
  assert.deepEqual(result.coverUrls, ['/abs/cover.jpg'])
  assert.deepEqual(result.days[1].stops, [])
  const [first, second] = result.days[0].stops
  assert.deepEqual(first.photoUrls, [
    '/notes/trip/a.jpg',
    'https://cdn.example/b.jpg',
  ])
  assert.deepEqual(first.time, { start: '09:30', end: undefined })
  assert.deepEqual([first.travel, first.travelSeconds], ['train', 720])
  assert.deepEqual(first.service, {
    number: 'G1234',
    depart: '09:40',
    arrive: undefined,
  })
  assert.deepEqual([second.travel, second.time], ['drive', undefined])
  assert.deepEqual(first.coordinates, [106.5, 29.6])
})

test('GCJ-02 drafts are converted to WGS84', () => {
  const result = parseTripDraft(draft({ coordinateSystem: 'gcj02' }), '/')
  assert.deepEqual(
    result.days[0].stops[0].coordinates,
    gcj02ToWgs84(106.5, 29.6)
  )
})

test('invalid drafts fail with the reason instead of dropping data', () => {
  const day = (stops) => ({ days: [{ date: '2026-12-05', stops }] })
  const cases = [
    [{ title: '' }, /title/],
    [{ days: [] }, /至少要有一天/],
    [{ days: [{ date: '2026-02-30' }] }, /真实存在/],
    [{ days: [{ date: '2026-12-06' }, { date: '2026-12-05' }] }, /晚于前一天/],
    [day([stop({ coordinates: [200, 0] })]), /coordinates/],
    [day([stop({ travel: 'rocket' })]), /travel 只能是/],
    [day([stop({ travelMinutes: 5 })]), /travelMinutes 只用于/],
    [
      day([stop({ travel: 'taxi', service: { number: 'X' } })]),
      /service 只用于/,
    ],
    [day([stop({ travel: 'flight', service: {} })]), /service 至少/],
    [day([stop({ travel: 'transit', transit: { lines: [] } })]), /lines 至少/],
    [
      day([stop({ transit: { lines: [{ name: '1号线' }] } })]),
      /transit 只用于/,
    ],
    [day([stop({ time: { end: '25:00' } })]), /time\.end/],
    [day([stop({ note: 123 })]), /note/],
    [day([stop({ time: {} })]), /time 必须/],
    [day([stop(), stop({ travel: 'walk' })]), /最后一站/],
    [day([stop({ photo: ['./a.jpg'] })]), /未知字段「photo」/],
    [{ coordinateSystem: 'bd09' }, /coordinateSystem/],
  ]
  for (const [patch, reason] of cases)
    assert.throws(() => parseTripDraft(draft(patch), '/'), reason)
})
