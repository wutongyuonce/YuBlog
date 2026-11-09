import assert from 'node:assert/strict'
import test from 'node:test'

import {
  gcj02ToWgs84,
  parseJourneyId,
  toTripDraft,
  wgs84ToGcj02,
} from '../src/utils/pitravel.mjs'
import { haversine } from '../src/utils/geo.mjs'

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
              route_transportation_type: 1,
            },
          ],
        },
      ],
    },
  },
}

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
  assert.deepEqual(draft.skipped, ['坏数据'])
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
  assert.equal(alley.travel, 'walk')
  assert.equal(alley.time, undefined)
  assert.equal(draft.days[1].stops[0].travel, 'straight')
})

test('a transport event becomes a departure and an arrival joined by its mode', () => {
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
  const draft = toTripDraft({
    code: 0,
    data: {
      journey: {
        name: 'x',
        day_plans: [
          {
            day_index: 1,
            timestamp: DAY1,
            events: [
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
            ],
          },
        ],
      },
    },
  })
  const [departure, arrival, train, , slowTrain, , oneEnded] =
    draft.days[0].stops
  assert.deepEqual(
    [departure.name, departure.travel, departure.travelSeconds, departure.note],
    ['禄口机场', 'flight', 8700, 'PN6458']
  )
  assert.deepEqual(departure.time, { start: '22:00' })
  assert.deepEqual(
    [arrival.name, arrival.travel, arrival.time],
    ['江北机场', 'drive', { end: '00:25' }]
  )
  assert.deepEqual([train.travel, slowTrain.travel], ['train', 'train'])
  // 只剩出发地时按普通地点导入。
  assert.equal(oneEnded.name, '南京 出发 至 重庆')
  // 出发地不可用时用到达地。
  assert.deepEqual(
    draft.days[0].stops[7].coordinates,
    draft.days[0].stops[1].coordinates
  )
  // 缺起飞时间时不编时长。
  assert.equal(draft.days[0].stops[8].travelSeconds, undefined)
  assert.equal(draft.days[0].stops.length, 10)
  assert.deepEqual(draft.skipped, [])
})

test('the transport family maps by event_type_v2 to its mode', () => {
  const event = (fields) => ({
    name: 'x',
    route_transportation_type: 2,
    start_poi_info: poi(106.5, 29.5, { name: '甲' }),
    end_poi_info: poi(106.6, 29.6, { name: '乙' }),
    ...fields,
  })
  const draft = toTripDraft({
    code: 0,
    data: {
      journey: {
        name: 'x',
        day_plans: [
          {
            day_index: 1,
            timestamp: DAY1,
            events: [
              event({ event_type: 103, event_type_v2: 202 }),
              event({ event_type: 203 }),
              event({ event_type: 204 }),
              event({ event_type: 208 }),
              event({ event_type: 200 }),
              event({ event_type: 103, route_transportation_type: 3 }),
            ],
          },
        ],
      },
    },
  })
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
