import { matchesAllTags, normalizePostTags } from './blog-tag-filter.js'

export const BLOG_PAGE_SIZE = 7

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

/** @param {number} page @param {number} pageCount @returns {(number | '…')[]} */
export function getPageNumbers(page, pageCount) {
  const numbers = Array.from({ length: pageCount }, (_, i) => i + 1).filter(
    (n) =>
      pageCount <= 7 || n === 1 || n === pageCount || Math.abs(n - page) <= 1
  )
  const result = []
  for (const n of numbers) {
    const previous = result.at(-1)
    if (typeof previous === 'number' && n - previous > 1) result.push('…')
    result.push(n)
  }
  return result
}
