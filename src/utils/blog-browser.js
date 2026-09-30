import { matchesAllTags, normalizePostTags } from './blog-tag-filter.js'

export const BLOG_PAGE_SIZE = 7

export const BLOG_CATEGORIES = [
  {
    id: 'tech',
    label: '技术',
    sources: ['技术向', '工具向', '技术', '工具', 'tech'],
  },
  {
    id: 'thought',
    label: '思考',
    sources: ['思考向', '思考', 'thought'],
  },
  {
    id: 'diary',
    label: '日记',
    sources: ['日记', '日记向', 'diary'],
  },
]

/** Preserve custom categories outside the explicit navigation groups.
 * @param {string} category
 */
export function getBlogCategory(category) {
  return (
    BLOG_CATEGORIES.find(
      (group) => group.label === category || group.sources.includes(category)
    )?.label ?? category
  )
}

/** Date-sorted published posts in; navigation shows at most four per group.
 * @template {{data: {category: string, draft?: boolean}}} T
 * @param {T[]} posts
 */
export function getCategoryPreviews(posts) {
  return BLOG_CATEGORIES.map(({ id, label }) => {
    const matches = posts.filter(
      ({ data }) => getBlogCategory(data.category) === label
    )
    return { id, label, count: matches.length, posts: matches.slice(0, 4) }
  })
}

/**
 * Blocking script for the list. The body is a string, not function.toString(),
 * so the bundler cannot rewrite it into a closure over other bindings.
 * Filtered URLs hide the list instead of painting the unfiltered first page.
 * @param {number} [pageSize]
 */
export function blogFirstPaintBootSource(pageSize = BLOG_PAGE_SIZE) {
  const size = Number(pageSize)
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new Error(`Invalid blog page size: ${pageSize}`)
  }
  return `(() => {
    const params = new URLSearchParams(location.search)
    const category = ${JSON.stringify(BLOG_CATEGORIES.map(({ id }) => `#${id}`))}.includes(location.hash) || (params.get('category') ?? '').trim()
    const hasTag = params.getAll('tag').some((tag) => tag.trim())
    const root = '[data-blog-browser]:not([data-paged])'
    let page = 1
    let css
    if (category || hasTag) {
      css = root + ' [data-blog-item]{display:none!important}'
    } else {
      const raw = params.get('page') ?? '1'
      const parsed = /^[0-9]+$/.test(raw) ? Number(raw) : 1
      page = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1
      const start = (page - 1) * ${size} + 1
      const end = page * ${size}
      const item = root + ' [data-post-list]>[data-blog-item]'
      css =
        item +
        ':not(:nth-child(n+' +
        start +
        '):nth-child(-n+' +
        end +
        ')){display:none!important}' +
        item +
        ':nth-child(n+' +
        start +
        '):nth-child(-n+' +
        end +
        '){display:block!important}'
    }
    document.documentElement.dataset.blogPaint = category || hasTag ? 'filter' : String(page)
    const style =
      document.head.querySelector('[data-blog-first-paint]') ||
      document.createElement('style')
    style.setAttribute('data-blog-first-paint', '')
    style.textContent = css
    if (!style.parentNode) document.head.appendChild(style)
  })()`
}

/** @typedef {{category: string, tags: string[], page: number}} BlogQuery */

/** @param {string | URLSearchParams} search @param {string} [hash] @returns {BlogQuery} */
export function parseBlogQuery(search, hash = '') {
  const params = new URLSearchParams(search)
  const value = params.get('page') ?? '1'
  const page = /^\d+$/.test(value) ? Number(value) : 1
  return {
    category:
      BLOG_CATEGORIES.find(({ id }) => hash === `#${id}`)?.label ??
      (params.get('category') ?? '').trim(),
    tags: normalizePostTags(params.getAll('tag')),
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  }
}

/** @param {BlogQuery} query */
export function serializeBlogQuery(query) {
  const params = new URLSearchParams()
  const group = BLOG_CATEGORIES.find(({ label }) => label === query.category)
  if (query.category && !group) params.set('category', query.category)
  for (const tag of normalizePostTags(query.tags)) params.append('tag', tag)
  if (query.page > 1) params.set('page', String(query.page))
  const search = params.toString()
  return (search ? `?${search}` : '') + (group ? `#${group.id}` : '')
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
      (!query.category ||
        data.category === query.category ||
        (BLOG_CATEGORIES.some(({ label }) => label === query.category) &&
          getBlogCategory(data.category) === query.category)) &&
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
