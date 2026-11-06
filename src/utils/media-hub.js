/** 影音书游合页：分类、排序与统计（上海时区日历）。 */

export const MEDIA_CATEGORIES = [
  {
    id: 'movie',
    label: '电影',
    verb: '看',
    todoLabel: '待看',
    doneMonthLabel: '本月已看',
    doneYearLabel: '今年已看',
  },
  {
    id: 'anime',
    label: '动漫',
    verb: '看',
    todoLabel: '待看',
    doneMonthLabel: '本月已看',
    doneYearLabel: '今年已看',
    noteHtml:
      '<a href="https://space.bilibili.com/521627597/bangumi" target="_blank" rel="noopener noreferrer">我的 B 站追番／追剧</a>',
  },
  {
    id: 'tv',
    label: '电视剧',
    verb: '看',
    todoLabel: '待看',
    doneMonthLabel: '本月已看',
    doneYearLabel: '今年已看',
  },
  {
    id: 'game',
    label: '游戏',
    verb: '玩',
    todoLabel: '待玩',
    doneMonthLabel: '本月已玩',
    doneYearLabel: '今年已玩',
    noteHtml:
      'Steam Friend Code：<a href="https://steamcommunity.com/id/wutongyuonce/" target="_blank" rel="noopener noreferrer">1554038676</a>',
  },
  {
    id: 'book',
    label: '书',
    verb: '读',
    todoLabel: '待读',
    doneMonthLabel: '本月已读',
    doneYearLabel: '今年已读',
  },
]

const SHANGHAI = 'Asia/Shanghai'

/** @param {Date} [now] */
export function shanghaiYmd(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** @param {string | undefined} date */
function parseYmd(date) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  return date
}

/**
 * 待看／玩在前；已完成按日期新→旧；无日期按标题（zh-Hans）。
 * @param {Array<{ status: string, date?: string, title: string }>} items
 */
export function sortMediaItems(items) {
  const collator = new Intl.Collator('zh-Hans-CN')
  return [...items].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'todo' ? -1 : 1
    if (a.status === 'todo') return 0
    const da = parseYmd(a.date)
    const db = parseYmd(b.date)
    if (da && db) return db.localeCompare(da)
    if (da && !db) return -1
    if (!da && db) return 1
    return collator.compare(a.title, b.title)
  })
}

/**
 * @param {Array<{ status: string, date?: string }>} items
 * @param {Date} [now]
 */
export function mediaStats(items, now = new Date()) {
  const today = shanghaiYmd(now)
  const [y, m] = today.split('-')
  const monthPrefix = `${y}-${m}`
  let todo = 0
  let doneMonth = 0
  let doneYear = 0
  let total = items.length
  for (const item of items) {
    if (item.status === 'todo') {
      todo++
      continue
    }
    const d = parseYmd(item.date)
    if (!d) continue
    if (d.startsWith(monthPrefix)) doneMonth++
    if (d.startsWith(`${y}-`)) doneYear++
  }
  return { todo, doneMonth, doneYear, total }
}

/** @param {string | undefined} hash */
export function categoryFromHash(hash) {
  const id = String(hash || '')
    .replace(/^#/, '')
    .split(/[/?]/)[0]
  return MEDIA_CATEGORIES.some((c) => c.id === id) ? id : 'movie'
}
