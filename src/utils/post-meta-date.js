const SITE_TIME_ZONE = 'Asia/Shanghai'

const siteCalendarFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SITE_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
})

/**
 * Calendar year / month / day of an instant in the site timezone (Asia/Shanghai).
 *
 * @param {Date | string} d
 * @returns {{ year: number, month: number, day: number }}
 */
export function getSiteCalendarParts(d) {
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) throw new Error('Invalid Date')

  const parts = Object.fromEntries(
    siteCalendarFormatter
      .formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)])
  )

  return parts
}

/**
 * Post-meta date: `YYYY 年 M 月 D 日` with spaces between digits and CJK.
 *
 * @param {Date | string} d
 */
export function formatPostMetaDate(d) {
  const { year, month, day } = getSiteCalendarParts(d)
  return `${year} 年 ${month} 月 ${day} 日`
}

/**
 * Short list-card date: `YYYY-MM-DD` in Asia/Shanghai.
 *
 * @param {Date | string} d
 */
export function formatPostListDate(d) {
  const { year, month, day } = getSiteCalendarParts(d)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
