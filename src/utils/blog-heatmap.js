const SITE_TIME_ZONE = 'Asia/Shanghai'
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000

const calendarDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SITE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const labelFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
})

/**
 * Shanghai calendar day for a publication instant, as `YYYY-MM-DD`.
 *
 * @param {Date | string} value
 */
export function calendarKey(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Invalid Date')
  return calendarDateFormatter.format(date)
}

/**
 * Chinese label for a calendar key. The key is already a civil date, so it is
 * formatted in UTC and does not shift across the Shanghai midnight boundary.
 *
 * @param {string} key
 */
export function formatHeatmapLabel(key) {
  const [year, month, day] = key.split('-').map(Number)
  if (!year || !month || !day) throw new Error('Invalid Date')

  return labelFormatter
    .format(new Date(Date.UTC(year, month - 1, day)))
    .replace(/\s/g, '')
}

/**
 * Absolute writing intensity. One post is already a visible step; four or
 * more share the darkest cell so a quiet blog does not collapse to one shade.
 *
 * @param {number} count
 */
export function levelForCount(count) {
  if (count <= 0) return 0
  if (count >= 4) return 4
  return count
}

/**
 * Monday-based index of a civil date. 0 is Monday.
 *
 * @param {number} year
 * @param {number} month
 * @param {number} day
 */
function mondayIndex(year, month, day) {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return (weekday + 6) % 7
}

/**
 * @param {string} key
 */
function shiftKey(key, days) {
  const [year, month, day] = key.split('-').map(Number)
  const shifted = new Date(
    Date.UTC(year, month - 1, day) + days * DAY_IN_MILLISECONDS
  )
  return shifted.toISOString().slice(0, 10)
}

/**
 * One calendar year as week columns, Monday through Sunday.
 * Days outside the year stay in the grid so January and December align,
 * but they are not writing days.
 *
 * @param {number} year
 * @param {Record<string, { title: string, href: string }[]>} postsByDate
 */
function buildYear(year, postsByDate) {
  const start = shiftKey(`${year}-01-01`, -mondayIndex(year, 1, 1))
  const end = shiftKey(`${year}-12-31`, 6 - mondayIndex(year, 12, 31))
  const weeks = []
  /** @type {string[]} */
  const weekLabels = []
  let week = []

  for (let key = start; key <= end; key = shiftKey(key, 1)) {
    const inYear = key.startsWith(`${year}-`)
    const posts = inYear ? (postsByDate[key] ?? []) : []
    const [, month, day] = key.split('-').map(Number)

    if (inYear && day === 1) weekLabels[weeks.length] = `${month}月`

    week.push(
      inYear
        ? {
            key,
            inYear: true,
            count: posts.length,
            level: levelForCount(posts.length),
          }
        : { key, inYear: false, count: 0, level: 0 }
    )

    if (week.length === 7) {
      weeks.push(week)
      week = []
    }
  }

  const cells = weeks.flat().filter((cell) => cell.inYear)

  return {
    year,
    total: cells.reduce((sum, cell) => sum + cell.count, 0),
    activeDays: cells.filter((cell) => cell.count > 0).length,
    weekLabels: weeks.map((_, index) => weekLabels[index] ?? ''),
    weeks,
  }
}

/**
 * Readable units already counted for one post. Every entry must provide a
 * non-negative integer; incomplete metadata must not silently lower totals.
 *
 * 字数由 `remark-reading-time` 在渲染文章时写进 frontmatter，所以这个字段缺失
 * 几乎总是意味着那篇文章渲染失败了。构建时真正的错误已经在更上面由
 * `[glob-loader]` 报过一次（Astro 会捕获它并继续），这里只负责把它指出来，
 * 不要让一个次生错误看起来像是新问题。
 *
 * @param {{ words?: number, href?: string, title?: string }} entry
 */
function entryWords(entry) {
  const identity = entry.href ?? entry.title ?? '(unknown post)'
  if (entry.words === undefined)
    throw new Error(
      `Missing rendered word count for ${identity}; ` +
        `the article likely failed to render — see the [glob-loader] error above`
    )
  if (!Number.isInteger(entry.words) || entry.words < 0) {
    throw new Error(`Invalid word count for ${identity}: ${entry.words}`)
  }
  return entry.words
}

/**
 * Builds year panels from the first publication year through the later of
 * the latest publication year and the current Shanghai year. `words` is the
 * sum of readable units whose Shanghai calendar day falls in that year.
 *
 * @param {{ date: Date | string, title: string, href: string, words?: number }[]} entries
 * @param {Date} [now]
 */
export function buildWritingHeatmap(entries, now = new Date()) {
  /** @type {Record<string, { title: string, href: string }[]>} */
  const postsByDate = {}
  /** @type {Record<number, number>} */
  const wordsByYear = {}

  for (const entry of [...entries].sort((a, b) => {
    const byDate = calendarKey(a.date).localeCompare(calendarKey(b.date))
    if (byDate !== 0) return byDate
    return (
      a.title.localeCompare(b.title, 'zh-Hans-CN') ||
      a.href.localeCompare(b.href)
    )
  })) {
    const key = calendarKey(entry.date)
    const year = Number(key.slice(0, 4))
    const posts = postsByDate[key] ?? []
    posts.push({ title: entry.title, href: entry.href })
    postsByDate[key] = posts
    wordsByYear[year] = (wordsByYear[year] ?? 0) + entryWords(entry)
  }

  const postYears = Object.keys(postsByDate).map((key) =>
    Number(key.slice(0, 4))
  )
  if (postYears.length === 0) return null

  const first = Math.min(...postYears)
  const last = Math.max(...postYears)
  const current = Number(calendarKey(now).slice(0, 4))
  const end = Math.max(last, current >= first ? current : last)
  const years = []

  for (let year = first; year <= end; year += 1) {
    years.push({
      ...buildYear(year, postsByDate),
      words: wordsByYear[year] ?? 0,
    })
  }

  return {
    selectedYear: current >= first && current <= end ? current : last,
    years,
    postsByDate,
  }
}
