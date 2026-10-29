import { SITE } from '../config'

/**
 * Formats a given date into a human-readable string.
 */
export function formatDate(d: Date | string, showYear = true, useUTC = false) {
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) throw new Error('Invalid Date')

  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    ...(showYear && { year: 'numeric' }),
    ...(useUTC && { timeZone: 'UTC' }),
  }

  return date.toLocaleDateString(SITE.lang, options)
}

/**
 * Gets the year from a given date.
 */
export function getYear(a: Date | string | number) {
  return new Date(a).getFullYear()
}

/**
 * Chinese long date with spaced units: 「2026 年 6 月 21 日」.
 * Uses Asia/Shanghai calendar fields so UTC midnights match published days.
 */
export function formatChineseDate(d: Date | string) {
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) throw new Error('Invalid Date')

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date)

  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value
  if (!year || !month || !day) throw new Error('Invalid Date')

  return `${year} 年 ${month} 月 ${day} 日`
}
