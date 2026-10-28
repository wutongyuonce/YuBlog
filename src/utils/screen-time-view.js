/**
 * 首页屏幕时间区块的唯一属主：接口响应的校验、柱高刻度、文案与 DOM 渲染。
 *
 * 服务端只输出加载态骨架，数据来自运行时接口，所以响应形状属于信任边界之外：
 * 先校验再写 DOM，并使用 `createElement` 而不是 `innerHTML`，不把上游字段当标记插入。
 */
import {
  buildScreenTimeChart,
  formatScreenTime,
  formatScreenTimeExact,
  parseScreenTime,
  SCREEN_TIME_ZONE,
  screenTimeDayLabel,
} from './screen-time.js'

/** 畸形响应一律按加载失败处理，不补默认值也不渲染可疑的部分结果。 */
export const parseScreenTimePayload = (value) => {
  try {
    return parseScreenTime(value)
  } catch {
    return null
  }
}

/** 柱高按绝对时长，刻度取整到小时，不足一小时仍保留一格。 */
const screenTimeScale = (snapshot) =>
  Math.max(
    3600,
    Math.ceil(
      Math.max(...snapshot.days.map((day) => day.seconds ?? 0)) / 3600
    ) * 3600
  )

/** 横轴日期用短写，与标题里的「M 月 D 日」区分。 */
const screenTimeDayDate = (date) =>
  `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`

const screenTimeHours = (seconds) =>
  seconds === null
    ? '—'
    : seconds > 0 && seconds < 360
      ? '<0.1'
      : (seconds / 3600).toFixed(1)

const screenTimePercent = (value) =>
  value < 0.1 ? '<0.1%' : `${value.toFixed(1)}%`

const updatedFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: SCREEN_TIME_ZONE,
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** 快照时间按北京时间标注。 */
const screenTimeUpdatedLabel = (updatedAt) =>
  updatedFormat.format(new Date(updatedAt))

const node = (document, tag, className, text) => {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

const emptyDetail = (day) =>
  day.seconds === null
    ? '这一天还没有采集记录。'
    : day.apps === null
      ? '这份记录尚未包含应用明细。'
      : '这一天没有活跃的应用记录。'

function buildDetail(document, day) {
  const panel = node(document, 'div', 'screen-time__detail')
  panel.setAttribute('role', 'region')
  panel.setAttribute('tabindex', '0')
  panel.setAttribute('aria-label', `${day.date}应用明细`)
  panel.append(
    node(document, 'h3', null, `${screenTimeDayDate(day.date)} 的应用时间`),
    node(
      document,
      'p',
      'screen-time__detail-total',
      `活跃总时长 ${day.seconds === null ? '暂无记录' : formatScreenTimeExact(day.seconds)}`
    )
  )
  if (!day.details.length) {
    panel.append(node(document, 'p', 'screen-time__empty', emptyDetail(day)))
    return panel
  }
  const list = node(document, 'ul', 'screen-time__apps')
  for (const app of day.details) {
    const row = node(document, 'li')
    row.setAttribute('data-screen-app', String(app.slot))
    row.style.setProperty('--app-color', `var(--screen-app-${app.slot})`)
    const swatch = node(document, 'span', 'screen-time__swatch')
    swatch.setAttribute('aria-hidden', 'true')
    row.append(
      swatch,
      node(document, 'span', 'screen-time__app-name', app.name),
      node(document, 'span', null, formatScreenTimeExact(app.seconds)),
      node(
        document,
        'span',
        'screen-time__percent',
        screenTimePercent(app.percent)
      )
    )
    list.append(row)
  }
  panel.append(list)
  return panel
}

function buildDay(document, day, scale) {
  const details = node(document, 'details', 'screen-time__day')
  details.setAttribute('data-screen-day', '')
  const summary = node(document, 'summary')
  summary.setAttribute(
    'aria-label',
    `${day.date}，${formatScreenTime(day.seconds)}，查看应用明细`
  )
  const hours = node(
    document,
    'span',
    'screen-time__hours',
    screenTimeHours(day.seconds)
  )
  hours.setAttribute('aria-hidden', 'true')
  const column = node(document, 'span', 'screen-time__column')
  column.setAttribute('aria-hidden', 'true')
  const bar = node(document, 'span', 'screen-time__bar')
  bar.style.setProperty('height', `${((day.seconds ?? 0) / scale) * 100}%`)
  for (const segment of day.segments) {
    const piece = node(document, 'span', 'screen-time__segment')
    piece.setAttribute('data-screen-slot', String(segment.slot))
    piece.style.setProperty('height', `${segment.percent}%`)
    piece.style.setProperty('--app-color', `var(--screen-app-${segment.slot})`)
    bar.append(piece)
  }
  column.append(bar)
  const label = node(document, 'time', null, screenTimeDayDate(day.date))
  label.setAttribute('datetime', day.date)
  label.setAttribute('aria-hidden', 'true')
  summary.append(hours, column, label)
  details.append(summary, buildDetail(document, day))
  const item = node(document, 'li')
  item.append(details)
  return item
}

function buildWeek(document, snapshot) {
  const chart = buildScreenTimeChart(snapshot)
  const scale = screenTimeScale(snapshot)
  const week = node(document, 'div', 'screen-time__week')
  week.append(node(document, 'p', 'screen-time__label', '近 7 天（小时）'))
  const list = node(document, 'ol', 'screen-time__chart')
  list.setAttribute('aria-label', '最近七天每日活跃时长')
  for (const day of chart.days) list.append(buildDay(document, day, scale))
  week.append(list)
  if (chart.legend.length) {
    const legend = node(document, 'ul', 'screen-time__legend')
    legend.setAttribute('aria-label', '应用颜色图例')
    for (const { name, slot } of chart.legend) {
      const item = node(document, 'li')
      item.style.setProperty('--app-color', `var(--screen-app-${slot})`)
      item.title = name
      const swatch = node(document, 'span', 'screen-time__swatch')
      swatch.setAttribute('aria-hidden', 'true')
      item.append(swatch, node(document, 'span', null, name))
      legend.append(item)
    }
    week.append(legend)
  }
  return week
}

function buildSummary(document, latest) {
  const summary = node(document, 'div', 'screen-time__summary')
  const label = node(
    document,
    'p',
    'screen-time__label',
    screenTimeDayLabel(latest.date)
  )
  label.setAttribute('data-screen-time-day', latest.date)
  summary.append(
    label,
    node(document, 'p', 'screen-time__value', formatScreenTime(latest.seconds)),
    node(document, 'p', 'screen-time__note', '仅统计电脑前的活跃时间')
  )
  return summary
}

/**
 * 把快照写进区块并结束加载状态；`snapshot` 为 null 表示这次加载失败。
 * 成功时替换骨架，失败时收起骨架，由说明文字接管。
 */
export function renderScreenTime(root, snapshot) {
  const document = root.ownerDocument
  const body = root.querySelector('[data-screen-time-body]')
  if (body) {
    body.replaceChildren(
      ...(snapshot
        ? [
            buildSummary(document, snapshot.days.at(-1)),
            buildWeek(document, snapshot),
          ]
        : [])
    )
  }
  const time = root.querySelector('[data-screen-time-time]')
  if (time) {
    if (snapshot) {
      time.dateTime = snapshot.updatedAt
      time.textContent = screenTimeUpdatedLabel(snapshot.updatedAt)
    } else {
      time.removeAttribute('datetime')
      time.textContent = '—'
    }
  }
  const message = root.querySelector('[data-screen-time-message]')
  if (message) {
    const text = snapshot ? '' : '暂时无法获取屏幕时间数据。'
    message.textContent = text
    message.toggleAttribute('hidden', !text)
  }
  root.dataset.state = snapshot ? 'ready' : 'error'
  root.setAttribute('aria-busy', 'false')
}
