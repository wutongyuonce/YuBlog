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
