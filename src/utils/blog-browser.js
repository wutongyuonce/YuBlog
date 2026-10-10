import { matchesAllTags, normalizePostTags } from './blog-tag-filter.js'

export const BLOG_PAGE_SIZE = 7

// URL compatibility only; these aliases never create or merge categories.
const LEGACY_CATEGORY_HASHES = { tech: '技术', thought: '思考', diary: '日记' }

/** Date-sorted published posts in; discover categories and keep at most four previews.
 * @template {{data: {category: string}}} T
 * @param {T[]} posts
 */
export function getCategoryPreviews(posts) {
  /** @type {Map<string, {id: string, label: string, count: number, posts: T[]}>} */
  const groups = new Map()
  for (const post of posts) {
    const label = post.data.category
    let group = groups.get(label)
    if (!group) {
      group = {
        id: serializeBlogQuery({ category: label, tags: [], page: 1 }).slice(1),
        label,
        count: 0,
        posts: [],
      }
      groups.set(label, group)
    }
    group.count++
    if (group.posts.length < 4) group.posts.push(post)
  }
  return Array.from(groups.values()).sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-Hans-CN')
  )
}

/** @param {string} hash */
function categoryFromHash(hash) {
  if (!hash.startsWith('#')) return ''
  const legacyId = hash.slice(1)
  if (Object.hasOwn(LEGACY_CATEGORY_HASHES, legacyId))
    return LEGACY_CATEGORY_HASHES[legacyId]
  try {
    return decodeURIComponent(
      hash.startsWith('#category=') ? hash.slice(10) : hash.slice(1)
    ).trim()
  } catch {
    return ''
  }
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
    const category = Boolean(location.hash.slice(1)) || (params.get('category') ?? '').trim()
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
    category: categoryFromHash(hash) || (params.get('category') ?? '').trim(),
    tags: normalizePostTags(params.getAll('tag')),
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  }
}

/** @param {BlogQuery} query */
export function serializeBlogQuery(query) {
  const params = new URLSearchParams()
  for (const tag of normalizePostTags(query.tags)) params.append('tag', tag)
  if (query.page > 1) params.set('page', String(query.page))
  const search = params.toString()
  const categoryId = encodeURIComponent(query.category)
  const reserved = Object.hasOwn(LEGACY_CATEGORY_HASHES, categoryId)
  const hash = query.category
    ? `#${reserved ? 'category=' : ''}${categoryId}`
    : ''
  return (search ? `?${search}` : '') + hash
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
