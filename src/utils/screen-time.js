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
 * @returns {{timeZone: string, updatedAt: string, days: Array<{date: string, seconds: number | null}>}}
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
    const maxSeconds = Math.ceil(
      (Date.parse(period.end) - Date.parse(period.start)) / 1000
    )
    if (
      day?.date !== period.date ||
      (seconds !== null &&
        (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > maxSeconds))
    )
      throw new Error('Screen time: invalid daily duration')
    return { date: day.date, seconds }
  })
  return { timeZone: SCREEN_TIME_ZONE, updatedAt: value.updatedAt, days }
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

export const screenTimeDayLabel = (date, now = new Date()) =>
  date === screenTimeDate(now)
    ? '今天活跃'
    : `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8))} 日活跃`
