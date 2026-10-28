import assert from 'node:assert/strict'
import test from 'node:test'

import { screenTimePeriods } from '../src/utils/screen-time.js'
import {
  parseScreenTimePayload,
  renderScreenTime,
} from '../src/utils/screen-time-view.js'
import { createDocument } from '../test-support/minimal-dom.mjs'

const UPDATED = '2026-10-27T12:00:00.000Z'

/** 每天的应用合计必须等于当日总时长，否则 `parseScreenTime` 会整体拒绝。 */
const day = (seconds, apps) => ({ date: null, seconds, apps })

const snapshot = (days) => ({
  timeZone: 'Asia/Shanghai',
  updatedAt: UPDATED,
  days: screenTimePeriods(new Date(UPDATED)).map(({ date }, index) => ({
    ...days[index],
    date,
  })),
})

const apps = [
  { name: 'Ghostty', seconds: 900 },
  { name: 'Safari', seconds: 450 },
  { name: 'Notes', seconds: 300 },
  { name: 'Chat', seconds: 100 },
  { name: 'Finder', seconds: 45 },
  { name: 'Preview', seconds: 4.5 },
  { name: 'Tiny', seconds: 0.5 },
]

/** 未采集、已采集但为 0、不足一小时、最长的一天，再加三份普通数据。 */
const week = snapshot([
  day(null, null),
  day(0, []),
  day(300, [{ name: 'Notes', seconds: 300 }]),
  day(1800, apps),
  day(1800, apps),
  day(1800, apps),
  day(1800, apps),
])

/** 与组件输出的骨架结构一致：一个待替换的 body、时间和说明。 */
function loadingRoot() {
  const document = createDocument()
  const root = document.createElement('section')
  root.dataset.state = 'loading'
  root.setAttribute('aria-busy', 'true')
  const body = document.createElement('div')
  body.setAttribute('data-screen-time-body', '')
  const skeleton = document.createElement('div')
  skeleton.className = 'screen-time__skeleton-day'
  body.append(skeleton)
  const time = document.createElement('time')
  time.setAttribute('data-screen-time-time', '')
  time.textContent = '—'
  const message = document.createElement('p')
  message.setAttribute('data-screen-time-message', '')
  message.toggleAttribute('hidden', true)
  root.append(body, time, message)
  return { root, body, time, message }
}

const heights = (body) =>
  body
    .querySelectorAll('.screen-time__bar')
    .map((bar) => Number.parseFloat(bar.style.height))

const texts = (nodes) => nodes.map((node) => node.textContent)

test('only a renderable snapshot passes the payload check', () => {
  assert.equal(parseScreenTimePayload(null), null)
  assert.equal(parseScreenTimePayload({}), null)
  assert.equal(parseScreenTimePayload({ ...week, days: [] }), null)
  const mismatched = snapshot([
    day(60, []),
    day(null, null),
    day(null, null),
    day(null, null),
    day(null, null),
    day(null, null),
    day(null, null),
  ])
  assert.equal(parseScreenTimePayload(mismatched), null)
  assert.deepEqual(parseScreenTimePayload(week), week)
})

test('rendering replaces the skeleton with the seven day chart', () => {
  const { root, body, time, message } = loadingRoot()
  renderScreenTime(root, week)

  assert.equal(root.dataset.state, 'ready')
  assert.equal(root.getAttribute('aria-busy'), 'false')
  assert.equal(body.querySelectorAll('.screen-time__skeleton-day').length, 0)
  assert.equal(body.querySelectorAll('[data-screen-day]').length, 7)

  // 未采集用「—」，真实零值是 0.0，不足一小时保留一格刻度。
  assert.deepEqual(texts(body.querySelectorAll('.screen-time__hours')), [
    '—',
    '0.0',
    '<0.1',
    '0.5',
    '0.5',
    '0.5',
    '0.5',
  ])
  // 最长的一天是一小时的整数倍时仍以它为准；未采集的一天没有柱子。
  assert.deepEqual(heights(body), [0, 0, (300 / 3600) * 100, 50, 50, 50, 50])

  assert.equal(
    body.querySelectorAll('.screen-time__value')[0].textContent,
    '30 分钟'
  )
  assert.match(
    body.querySelectorAll('[data-screen-time-day]')[0].textContent,
    /活跃$/
  )
  assert.equal(
    body
      .querySelectorAll('[data-screen-time-day]')[0]
      .getAttribute('data-screen-time-day'),
    week.days.at(-1).date
  )

  // 七天共用 Top 5，其余合并为「其他」；明细保留全部应用与占比。
  assert.deepEqual(
    body
      .querySelectorAll('.screen-time__legend')[0]
      .children.map((item) => item.title),
    ['Ghostty', 'Safari', 'Notes', 'Chat', 'Finder', '其他']
  )
  const rows = body
    .querySelectorAll('[data-screen-day]')[3]
    .querySelectorAll('[data-screen-app]')
  assert.equal(rows.length, 7)
  assert.equal(
    rows[5].querySelector('.screen-time__percent').textContent,
    '0.3%'
  )
  assert.equal(
    rows[6].querySelector('.screen-time__percent').textContent,
    '<0.1%'
  )
  assert.equal(
    body
      .querySelectorAll('[data-screen-day]')[3]
      .querySelectorAll('.screen-time__segment').length,
    6
  )
  assert.deepEqual(texts(body.querySelectorAll('.screen-time__empty')), [
    '这一天还没有采集记录。',
    '这一天没有活跃的应用记录。',
  ])

  assert.equal(time.textContent, '10/27 20:00')
  assert.equal(time.getAttribute('datetime'), UPDATED)
  assert.equal(message.hasAttribute('hidden'), true)
})

test('bars are measured against whole hours above the one hour floor', () => {
  const { root, body } = loadingRoot()
  const busy = snapshot([
    day(5000, [{ name: 'Ghostty', seconds: 5000 }]),
    ...Array.from({ length: 6 }, () => day(1800, apps)),
  ])
  renderScreenTime(root, busy)
  // 5000 秒向上取整到两小时刻度，因此最长的一天不是满格。
  assert.deepEqual(heights(body), [(5000 / 7200) * 100, 25, 25, 25, 25, 25, 25])
})

test('a failed request collapses the chart and leaves the reason visible', () => {
  const { root, body, time, message } = loadingRoot()
  renderScreenTime(root, null)
  assert.equal(root.dataset.state, 'error')
  assert.equal(root.getAttribute('aria-busy'), 'false')
  assert.equal(body.children.length, 0)
  assert.equal(message.hasAttribute('hidden'), false)
  assert.equal(message.textContent, '暂时无法获取屏幕时间数据。')
  assert.equal(time.textContent, '—')
  assert.equal(time.getAttribute('datetime'), null)
})
