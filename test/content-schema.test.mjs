import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'astro/zod'
import {
  calendarSchema,
  friendSchema,
  postSchema,
  projectSchema,
  tripSchema,
} from '../src/content/schema.ts'

const post = postSchema({ image: () => z.any() })
const trip = tripSchema({ image: () => z.string() })
const calendar = calendarSchema({ image: () => z.string() })
const requiredPost = {
  title: '  示例文章  ',
  pubDate: '2026-09-21',
  category: ' 技术向 ',
}

test('post fields keep their defaults, trimming and date coercion', () => {
  const parsed = post.parse(requiredPost)
  assert.equal(parsed.title, '示例文章')
  assert.equal(parsed.category, '技术向')
  assert.ok(parsed.pubDate instanceof Date)
  assert.equal(parsed.minutesRead, true)
  assert.equal(parsed.draft, false)
  assert.equal(parsed.redirect, '')
  assert.deepEqual(parsed.tags, [])
})

test('content boundaries reject empty categories and malformed URLs', () => {
  assert.equal(
    post.safeParse({ ...requiredPost, category: '  ' }).success,
    false
  )
  assert.equal(
    post.safeParse({ ...requiredPost, redirect: 'not-a-url' }).success,
    false
  )
  assert.equal(
    projectSchema.safeParse({
      id: 'p',
      link: 'not-a-url',
      desc: 'p',
      category: 'Personal',
    }).success,
    false
  )
  assert.equal(
    friendSchema.safeParse({
      id: 'f',
      name: 'f',
      link: 'not-a-url',
      desc: 'f',
      category: '推荐',
    }).success,
    false
  )
})

test('a title image without meaningful alt text is rejected', () => {
  assert.equal(
    post.safeParse({
      ...requiredPost,
      titleImage: {
        src: '/cover.webp',
        width: 1200,
        height: 630,
        format: 'webp',
      },
      titleImageAlt: '  ',
    }).success,
    false
  )
})

const validTrip = {
  title: '重庆',
  start: '2026-11-06',
  end: '2026-11-07',
  days: [
    {
      date: '2026-11-06',
      stops: [
        {
          name: 'A',
          coordinates: [106.5, 29.5],
          time: { start: '09:30' },
          route: {
            mode: 'walk',
            distance: 10,
            path: [
              [106.5, 29.5],
              [106.6, 29.6],
            ],
          },
        },
      ],
    },
    { date: '2026-11-07', stops: [] },
  ],
}

test('trips default their images and accept optional stop fields', () => {
  const parsed = trip.parse(validTrip)
  assert.deepEqual(parsed.cover, [])
  assert.deepEqual(parsed.days[0].stops[0].photos, [])
})

test('trip days must be ordered and match start and end', () => {
  const [first, second] = validTrip.days
  for (const broken of [
    { ...validTrip, days: [second, first] },
    { ...validTrip, end: '2026-11-08' },
    { ...validTrip, days: [first, { ...second, date: '2026-11-06' }] },
  ])
    assert.equal(trip.safeParse(broken).success, false)
})

test('trip stops reject bad coordinates, times and malformed routes', () => {
  const route = validTrip.days[0].stops[0].route
  const withStop = (patch) => ({
    ...validTrip,
    days: [
      {
        ...validTrip.days[0],
        stops: [{ ...validTrip.days[0].stops[0], ...patch }],
      },
      validTrip.days[1],
    ],
  })
  for (const patch of [
    { coordinates: [200, 29.5] },
    { time: { start: '24:00' } },
    { route: { mode: 'drive', distance: 1, path: [[106.5, 29.5]] } },
    { route: { ...route, mode: 'straight' } },
    // 班次只属于飞机、火车、船，乘坐明细只属于公共交通。
    { route: { ...route, mode: 'taxi', service: { number: 'G1' } } },
    { route: { ...route, transit: { lines: [{ name: '9号线' }] } } },
  ])
    assert.equal(trip.safeParse(withStop(patch)).success, false)
  for (const patch of [
    { route: { ...route, mode: 'flight', service: { number: 'MU1' } } },
    {
      route: {
        ...route,
        mode: 'transit',
        transit: { fare: '3元', lines: [{ name: '9号线', stops: 5 }] },
      },
    },
  ])
    assert.equal(trip.safeParse(withStop(patch)).success, true)
})

test('calendar entries coerce YAML Date values and validate optional place and time', () => {
  const parsed = calendar.parse({
    title: ' 南京博物院 ',
    date: new Date('2026-11-12T00:00:00Z'),
    time: '14:30',
    place: { name: ' 南京博物院 ', coordinates: [118.8253, 32.0414] },
  })
  assert.equal(parsed.title, '南京博物院')
  assert.equal(parsed.date, '2026-11-12')
  assert.deepEqual(parsed.photos, [])
  assert.equal(calendar.parse({ date: '2026-10-13' }).title, undefined)
  assert.equal(
    calendar.safeParse({ title: 'x', date: '2026-02-30' }).success,
    false
  )
  assert.equal(
    calendar.safeParse({ title: 'x', date: '2026-11-12', time: '25:00' })
      .success,
    false
  )
})
