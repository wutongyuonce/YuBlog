/** 屏幕时间公开快照的形状、北京时间日期和展示格式。无记录用 null，与真实零值区分。 */
export const SCREEN_TIME_ZONE = 'Asia/Shanghai'
const DAY_MS = 86_400_000

export const screenTimeDate = (value) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: SCREEN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value)

export function screenTimePeriods(now) {
  const today = screenTimeDate(now)
  const midnight = new Date(`${today}T00:00:00+08:00`).getTime()
  return Array.from({ length: 7 }, (_, index) => {
    const start = midnight - (6 - index) * DAY_MS
    const end = Math.min(start + DAY_MS, now.getTime())
    return {
      date: screenTimeDate(new Date(start)),
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
    }
  })
}

/**
 * 构建与同步共同验证；重新构造白名单字段，额外数据不会进入公开文件。
 * @returns {{timeZone: string, updatedAt: string, days: Array<{date: string, seconds: number | null, apps: Array<{name: string, seconds: number}> | null}>}}
 */
export function parseScreenTime(value) {
  if (
    value?.timeZone !== SCREEN_TIME_ZONE ||
    typeof value.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    !Array.isArray(value.days) ||
    value.days.length !== 7
  )
    throw new Error('Screen time: invalid snapshot')
  const periods = screenTimePeriods(new Date(value.updatedAt))
  const days = value.days.map((day, index) => {
    const seconds = day?.seconds
    const period = periods[index]
    // 上游按秒取整，完整一天可能比实际跨度多出不足一秒。
    const maxSeconds =
      Math.ceil((Date.parse(period.end) - Date.parse(period.start)) / 1000) + 1
    if (
      day?.date !== period.date ||
      (seconds !== null &&
        (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > maxSeconds))
    )
      throw new Error('Screen time: invalid daily duration')
    const apps = day.apps == null ? null : parseApps(day.apps)
    if (
      apps !== null &&
      ((seconds === null && apps.length > 0) ||
        Math.abs(
          apps.reduce((sum, app) => sum + app.seconds, 0) - (seconds ?? 0)
        ) > 1)
    )
      throw new Error('Screen time: app durations must match daily total')
    return { date: day.date, seconds, apps }
  })
  return { timeZone: SCREEN_TIME_ZONE, updatedAt: value.updatedAt, days }
}

function parseApps(value) {
  if (!Array.isArray(value)) throw new Error('Screen time: invalid apps')
  const names = new Set()
  return value
    .map((app) => {
      const name = typeof app?.name === 'string' ? app.name.trim() : ''
      if (
        !name ||
        names.has(name) ||
        !Number.isFinite(app.seconds) ||
        app.seconds <= 0
      )
        throw new Error('Screen time: invalid app duration')
      names.add(name)
      return { name, seconds: app.seconds }
    })
    .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name))
}

/**
 * 七天共用 Top 5、颜色和堆叠顺序；明细保留全部应用，避免小色块难以命中。
 * @param {ReturnType<typeof parseScreenTime>} snapshot
 */
export function buildScreenTimeChart(snapshot) {
  const totals = new Map()
  for (const day of snapshot.days)
    for (const app of day.apps ?? [])
      totals.set(app.name, (totals.get(app.name) ?? 0) + app.seconds)
  const top = [...totals]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
  const slots = new Map(top.map(([name], slot) => [name, slot]))
  const legend = top.map(([name], slot) => ({ name, slot }))
  if (totals.size > 5) legend.push({ name: '其他', slot: 5 })
  if (snapshot.days.some((day) => day.apps === null && day.seconds > 0))
    legend.push({ name: '明细缺失', slot: 6 })
  const days = snapshot.days.map((day) => {
    const total = (day.apps ?? []).reduce((sum, app) => sum + app.seconds, 0)
    const details = (day.apps ?? []).map((app) => ({
      ...app,
      slot: slots.get(app.name) ?? 5,
      percent: total ? (app.seconds / total) * 100 : 0,
    }))
    const groups = new Map()
    for (const app of details)
      groups.set(app.slot, (groups.get(app.slot) ?? 0) + app.seconds)
    const segments = [...groups]
      .sort((a, b) => a[0] - b[0])
      .map(([slot, seconds]) => ({
        slot,
        percent: (seconds / total) * 100,
      }))
    // 旧的仅总时长快照仍能阅读，不能据此编造应用明细。
    if (day.apps === null && day.seconds > 0)
      segments.push({ slot: 6, percent: 100 })
    return { ...day, details, segments }
  })
  return { days, legend }
}

export function formatScreenTime(seconds) {
  if (seconds === null) return '暂无记录'
  if (seconds === 0) return '0 分钟'
  if (seconds < 60) return '不到 1 分钟'
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  return [
    hours ? `${hours} 小时` : '',
    minutes % 60 ? `${minutes % 60} 分钟` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

export function formatScreenTimeExact(seconds) {
  if (seconds > 0 && seconds < 0.5) return '不到 1 秒'
  const whole = Math.round(seconds)
  return [
    whole >= 3600 ? `${Math.floor(whole / 3600)}时` : '',
    whole >= 60 && Math.floor(whole / 60) % 60
      ? `${Math.floor(whole / 60) % 60}分`
      : '',
    whole % 60 || whole === 0 ? `${whole % 60}秒` : '',
  ]
    .filter(Boolean)
    .join('')
}

export const screenTimeDayLabel = (date, now = new Date()) =>
  date === screenTimeDate(now)
    ? '今天活跃'
    : `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8))} 日活跃`
