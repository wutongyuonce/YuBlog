import { matchesAllTags, normalizePostTags } from './blog-tag-filter.js'

export const BLOG_PAGE_SIZE = 7

/**
 * CSS applied before the deferred pager runs. Self-contained so it can be
 * inlined into a blocking script; it must not close over other bindings.
 * Filtered URLs hide the list instead of painting the unfiltered first page.
 * @param {string} search @param {number} pageSize
 */
export function blogFirstPaintCss(search, pageSize) {
  const size = Number(pageSize)
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new Error(`Invalid blog page size: ${pageSize}`)
  }
  const params = new URLSearchParams(String(search ?? ''))
  const category = (params.get('category') ?? '').trim()
  const hasTag = params.getAll('tag').some((tag) => tag.trim())
  const root = '[data-blog-browser]:not([data-paged])'
  if (category || hasTag) {
    return `${root} [data-blog-item]{display:none!important}`
  }
  const raw = params.get('page') ?? '1'
  const parsed = /^\d+$/.test(raw) ? Number(raw) : 1
  const page = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1
  const start = (page - 1) * size + 1
  const end = page * size
  const item = `${root} [data-post-list]>[data-blog-item]`
  // The stylesheet fallback hides every item after the first page. The visible
  // window has to win that rule, or page 2+ would paint blank until JS runs.
  return (
    `${item}:not(:nth-child(n+${start}):nth-child(-n+${end})){display:none!important}` +
    `${item}:nth-child(n+${start}):nth-child(-n+${end}){display:block!important}`
  )
}

/** @param {number} [pageSize] */
export function blogFirstPaintBootSource(pageSize = BLOG_PAGE_SIZE) {
  const size = Number(pageSize)
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new Error(`Invalid blog page size: ${pageSize}`)
  }
  return `(() => {
    const style =
      document.head.querySelector('[data-blog-first-paint]') ||
      document.createElement('style')
    style.setAttribute('data-blog-first-paint', '')
    style.textContent = (${blogFirstPaintCss.toString()})(location.search, ${size})
    if (!style.parentNode) document.head.appendChild(style)
  })()`
}

/** @typedef {{category: string, tags: string[], page: number}} BlogQuery */

/** @param {string | URLSearchParams} search @returns {BlogQuery} */
export function parseBlogQuery(search) {
  const params = new URLSearchParams(search)
  const value = params.get('page') ?? '1'
  const page = /^\d+$/.test(value) ? Number(value) : 1
  return {
    category: (params.get('category') ?? '').trim(),
    tags: normalizePostTags(params.getAll('tag')),
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  }
}

/** @param {BlogQuery} query */
export function serializeBlogQuery(query) {
  const params = new URLSearchParams()
  if (query.category) params.set('category', query.category)
  for (const tag of normalizePostTags(query.tags)) params.append('tag', tag)
  if (query.page > 1) params.set('page', String(query.page))
  const search = params.toString()
  return search ? `?${search}` : ''
}

/**
 * Takes date-sorted posts; filters the full set before selecting a page.
 * @template {{data: {category: string, tags: string[]}}} T
 * @param {T[]} posts
 * @param {BlogQuery} query
 */
export function selectBlogPage(posts, query) {
  const matches = posts.filter(
    ({ data }) =>
      (!query.category || data.category === query.category) &&
      matchesAllTags(data.tags, query.tags)
  )
  const pageCount = Math.ceil(matches.length / BLOG_PAGE_SIZE)
  const page = Math.max(1, Math.min(query.page, pageCount || 1))
  return {
    items: matches.slice((page - 1) * BLOG_PAGE_SIZE, page * BLOG_PAGE_SIZE),
    total: matches.length,
    pageCount,
    page,
  }
}

/** @param {{data: {category: string}}[]} posts */
export function buildCategorySummary(posts) {
  const counts = new Map()
  for (const { data } of posts) {
    counts.set(data.category, (counts.get(data.category) ?? 0) + 1)
  }
  return [...counts]
    .map(([category, count]) => ({ category, count }))
    .sort(
      (a, b) =>
        b.count - a.count || a.category.localeCompare(b.category, 'zh-CN')
    )
}

/**
 * Keep at most six slots; middle windows show the current and next page.
 * Ellipses represent at least two omitted pages.
 * @param {number} page @param {number} pageCount @returns {(number | '…')[]}
 */
export function getPageNumbers(page, pageCount) {
  if (pageCount <= 6) return Array.from({ length: pageCount }, (_, i) => i + 1)
  if (page <= 4) return [1, 2, 3, 4, '…', pageCount]
  if (page >= pageCount - 3) {
    return [1, '…', pageCount - 3, pageCount - 2, pageCount - 1, pageCount]
  }
  return [1, '…', page, page + 1, '…', pageCount]
}
