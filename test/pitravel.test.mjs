import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  gcj02ToWgs84,
  legRequests,
  parseJourneyId,
  toTripDraft,
  wgs84ToGcj02,
} from '../src/utils/pitravel.mjs'
import { haversine } from '../src/utils/geo.mjs'
import { SCHEDULED_MODES } from '../src/utils/trips.js'

const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/pitravel/${name}`, import.meta.url))
  )

const poi = (lng, lat, extra = {}) => ({
  location: { longitude: String(lng), latitude: String(lat) },
  coordinate_type: 'GCJ02',
  address: '重庆市某路 1 号',
  category: [{ display_name: '景点', icon: '⛲️' }],
  image: 'https://cdn.example/place.png?sly_wh=500,280',
  ...extra,
})

// 2026-11-06 00:00 与 2026-11-07 00:00（上海）。
const DAY1 = Date.UTC(2026, 10, 5, 16)
const DAY2 = Date.UTC(2026, 10, 6, 16)

const response = {
  code: 0,
  msg: '成功',
  data: {
    user_profile: {
      user_id: 'uid-secret',
      nickname: '作者',
      avatar: 'https://a/b.png',
    },
    journey: {
      name: ' 重庆 3 日游 ',
      timezone: 'Asia/Shanghai',
      cover: 'https://cdn.example/cover.png',
      image_list: [{ image_url: 'https://cdn.example/cover.png' }],
      user_info: { nickname: '作者' },
      day_plans: [
        {
          day_index: -1,
          timestamp: 0,
          events: [{ name: '待定', start_poi_info: poi(106, 29) }],
        },
        {
          day_index: 2,
          timestamp: DAY2,
          remark: '',
          events: [
            {
              name: '鹅岭公园',
              start_poi_info: poi(106.53, 29.55),
              // 最后一站的编码不会被读取。
              route_transportation_type: 9,
            },
          ],
        },
        {
          day_index: 1,
          timestamp: DAY1,
          remark: 'SPA·绿心',
          events: [
            {
              name: '绿心公园',
              start_time: '11:00',
              end_time: '25:00',
              note: ' 午饭 ',
              start_poi_info: poi(106.5957, 29.5575),
              route_transportation_type: 0,
              image_list: [
                { image_url: 'https://cdn.example/p1.png?imageView2/w/300' },
                { image_url: 'not-a-url' },
              ],
            },
            { name: '坏数据', start_poi_info: { location: {} } },
            {
              name: '下浩里',
              start_poi_info: poi(106.6, 29.56),
              route_transportation_type: 5,
            },
          ],
        },
      ],
    },
  },
}

const journey = (events) => ({
  code: 0,
  data: {
    journey: {
      name: 'x',
      day_plans: [{ day_index: 1, timestamp: DAY1, events }],
    },
  },
})
const kinds = (draft) => draft.issues.map((issue) => issue.kind)

test('journey ids come from share links or bare digits only', () => {
  assert.equal(
    parseJourneyId(
      'https://www.pitravel.cn/plan/journey/7704652144825522565?lang=cn'
    ),
    '7704652144825522565'
  )
  assert.equal(parseJourneyId(' 7704652144825522565 '), '7704652144825522565')
  assert.throws(() => parseJourneyId('https://www.pitravel.cn/plan/'))
})

test('GCJ-02 converts back to the WGS84 point it came from', () => {
  const wgs = [106.5957, 29.5575]
  const gcj = wgs84ToGcj02(...wgs)
  assert.ok(haversine(wgs, gcj) > 100, 'China is offset')
  assert.ok(haversine(wgs, gcj02ToWgs84(...gcj)) < 0.5)
  assert.deepEqual(gcj02ToWgs84(2.35, 48.85), [2.35, 48.85])
})

test('drafts keep dated days in order and map stops to neutral fields', () => {
  const draft = toTripDraft(response)
  assert.equal(draft.title, '重庆 3 日游')
  assert.equal(draft.start, '2026-11-06')
  assert.equal(draft.end, '2026-11-07')
  assert.deepEqual(
    draft.days.map((day) => [day.date, day.summary, day.stops.length]),
    [
      ['2026-11-06', 'SPA·绿心', 2],
      ['2026-11-07', undefined, 1],
    ]
  )
  // 缺坐标的条目跳过并记为数据问题；最后一站的未知编码不报。
  assert.deepEqual(kinds(draft), ['data'])
  assert.match(draft.issues[0].message, /坏数据/)
  assert.deepEqual(draft.coverUrls, ['https://cdn.example/cover.png'])

  const [park, alley] = draft.days[0].stops
  assert.equal(park.category, '景点')
  assert.equal(park.emoji, '⛲️')
  assert.deepEqual(park.time, { start: '11:00', end: undefined })
  assert.equal(park.note, '午饭')
  assert.deepEqual(park.photoUrls, ['https://cdn.example/p1.png'])
  assert.equal(park.placeImageUrl, 'https://cdn.example/place.png')
  assert.notDeepEqual(park.coordinates, [106.5957, 29.5575])
  assert.equal(park.travel, 'drive')
  assert.equal(alley.travel, 'taxi')
  assert.equal(alley.time, undefined)
  assert.equal(draft.days[1].stops[0].travel, undefined)
})

test('a transport event becomes two stops joined by a scheduled leg', () => {
  const flight = (number, type = 201) => ({
    event_type: type,
    name: '南京 出发 至 重庆',
    start_time: '22:00',
    end_time: '00:25',
    route_transportation_type: 0,
    transport_info: {
      transport_num: number,
      transport_start_time: DAY1 + 79_200_000,
      transport_end_time: DAY1 + 87_900_000,
    },
    start_poi_info: poi(118.87, 31.73, { name: '禄口机场' }),
    end_poi_info: poi(106.66, 29.71, { name: '江北机场' }),
  })
  const draft = toTripDraft(
    journey([
      flight('PN6458'),
      flight('G1234', 200),
      flight('1461', 200),
      { ...flight('MU7718'), end_poi_info: undefined },
      { ...flight('MU7719'), start_poi_info: { name: '无坐标' } },
      {
        ...flight('CA1234'),
        transport_info: {
          transport_num: 'CA1234',
          transport_start_time: null,
          transport_end_time: DAY1,
        },
      },
    ])
  )
  const stops = draft.days[0].stops
  const [departure, arrival, train, , slowTrain, , oneEnded] = stops
  assert.deepEqual(
    [departure.name, departure.travel, departure.travelSeconds],
    ['禄口机场', 'flight', 8700]
  )
  // 班次号和时刻属于两站之间的路段，不再写进备注或重复成站点时间。
  assert.deepEqual(departure.service, {
    number: 'PN6458',
    depart: '22:00',
    arrive: '00:25',
  })
  assert.equal(departure.note, undefined)
  assert.deepEqual([departure.time, arrival.time], [undefined, undefined])
  assert.deepEqual([arrival.name, arrival.travel], ['江北机场', 'drive'])
  assert.deepEqual([train.travel, slowTrain.travel], ['train', 'train'])
  assert.equal(train.service.number, 'G1234')
  // 只剩出发地时按普通地点导入。
  assert.equal(oneEnded.name, '南京 出发 至 重庆')
  // 出发地不可用时用到达地。
  assert.deepEqual(stops[7].coordinates, stops[1].coordinates)
  // 缺起飞时间时不编时长。
  assert.equal(stops[8].travelSeconds, undefined)
  assert.equal(stops.length, 10)
  assert.deepEqual(kinds(draft), ['data', 'data'])
})

test('the transport family maps by event_type_v2 to its mode', () => {
  const event = (fields) => ({
    name: 'x',
    route_transportation_type: 2,
    start_poi_info: poi(106.5, 29.5, { name: '甲' }),
    end_poi_info: poi(106.6, 29.6, { name: '乙' }),
    ...fields,
  })
  const draft = toTripDraft(
    journey([
      event({ event_type: 103, event_type_v2: 202 }),
      event({ event_type: 203 }),
      event({ event_type: 204 }),
      event({ event_type: 208 }),
      event({ event_type: 200 }),
      event({ event_type: 103, route_transportation_type: 3 }),
      event({ event_type: 103 }),
    ])
  )
  const stops = draft.days[0].stops
  assert.deepEqual(
    [0, 2, 4, 6, 8].map((index) => [stops[index].travel, stops[index].emoji]),
    [
      ['train', '🚄'],
      ['ferry', '⛴️'],
      ['drive', '🚗'],
      ['transit', '🚌'],
      ['transit', '🚌'],
    ]
  )
  // 到达站之后的骑行、普通地点之后的公共交通。
  assert.equal(stops[1].travel, 'bike')
  assert.equal(stops[10].travel, 'transit')
  assert.deepEqual(draft.issues, [])
})

test('values the adapter does not cover are reported by kind', () => {
  const draft = toTripDraft(
    journey([
      {
        name: '甲',
        start_poi_info: poi(106.5, 29.5),
        route_transportation_type: 7,
      },
      { name: '乙', event_type: 209, start_poi_info: poi(106.6, 29.6) },
      {
        name: '丙',
        start_poi_info: poi(106.7, 29.7, { coordinate_type: 'BD09' }),
        image_list: [
          { image_url: 'https://cdn.example/v.png', video_url: 'x' },
        ],
      },
    ])
  )
  assert.deepEqual(kinds(draft).toSorted(), [
    'schema',
    'source',
    'source',
    'source',
  ])
  for (const pattern of [/route_transportation_type=7/, /209/, /BD09/])
    assert.ok(draft.issues.some((issue) => pattern.test(issue.message)))
  // 未知编码按驾车继续，一次报出全部问题。
  assert.equal(draft.days[0].stops[0].travel, 'drive')
})

test('route legs are requested once and their answers become hints', () => {
  const detail = journey([
    {
      name: '甲',
      start_poi_info: poi(106.5, 29.5, { inner_poi_id: 'a' }),
      route_transportation_type: 3,
    },
    {
      name: '乙',
      start_poi_info: poi(106.6, 29.6, { inner_poi_id: 'b' }),
      route_transportation_type: 3,
    },
    // 同一地点之间不请求。
    { name: '乙', start_poi_info: poi(106.6, 29.6, { inner_poi_id: 'b' }) },
  ])
  assert.deepEqual(legRequests(detail), [
    { originPoiId: 'a', destinationPoiId: 'b', travelType: 3 },
  ])
  const transit = fixture('transit-route.json')
  transit.data.routeData[0].originPoiId = 'a'
  transit.data.routeData[0].destinationPoiId = 'b'
  const [first] = toTripDraft(detail, transit).days[0].stops
  assert.equal(first.routeHint.distance, 7722)
  assert.equal(first.routeHint.duration, 2489)
  assert.deepEqual(first.routeHint.transit, {
    fare: '3元',
    lines: [{ name: '轨道交通9号线', from: '溉澜溪', to: '观音桥', stops: 5 }],
  })
  // 路线接口失败只降级，不终止。
  const failed = toTripDraft(detail, { success: false, msg: '限流' })
  assert.equal(failed.days[0].stops[0].routeHint, undefined)
  assert.deepEqual(kinds(failed), ['data'])
})

test('a real journey and its routes convert without issues', () => {
  const detail = fixture('journey.json')
  const routes = fixture('route.json')
  assert.equal(legRequests(detail).length, routes.data.routeData.length)
  const draft = toTripDraft(detail, routes)
  assert.deepEqual(draft.issues, [])
  const stops = draft.days.flatMap((day) => day.stops)
  // 除最后一站外，每站要么是班次，要么拿到了圆周的路线。
  for (const stop of stops.slice(0, -1))
    assert.ok(
      SCHEDULED_MODES.has(stop.travel) ? stop.service : stop.routeHint,
      stop.name
    )
  assert.ok(stops.some((stop) => stop.travel === 'taxi'))
  assert.deepEqual(
    stops.filter((stop) => stop.service).map((stop) => stop.service.number),
    ['PN6458', 'MU7718']
  )
})

test('two plans on the same date merge instead of dropping stops', () => {
  const day = (name) => ({
    day_index: 1,
    timestamp: DAY1,
    events: [{ name, start_poi_info: poi(106.5, 29.5) }],
  })
  const draft = toTripDraft({
    code: 0,
    data: { journey: { name: 'x', day_plans: [day('甲'), day('乙')] } },
  })
  assert.deepEqual(
    draft.days.map((item) => item.stops.map((stop) => stop.name)),
    [['甲', '乙']]
  )
})

test('drafts carry no source identity', () => {
  const text = JSON.stringify(toTripDraft(response))
  for (const leaked of ['作者', 'a/b.png', 'uid-secret'])
    assert.equal(text.includes(leaked), false, leaked)
})

test('refused or empty journeys fail loudly', () => {
  assert.throws(
    () => toTripDraft({ code: -15002, msg: '行程不存在', data: null }),
    /行程不存在/
  )
  assert.throws(() =>
    toTripDraft({
      code: 0,
      data: { journey: { name: '空', day_plans: [{ day_index: -1 }] } },
    })
  )
})
