import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import {
  BLOG_PAGE_SIZE,
  parseBlogQuery,
  serializeBlogQuery,
  selectBlogPage,
  buildCategorySummary,
  getPageNumbers,
  blogFirstPaintCss,
  blogFirstPaintBootSource,
} from '../src/utils/blog-browser.js'

const posts = Array.from({ length: 13 }, (_, id) => ({
  id,
  data: {
    category: id < 2 ? '工具向' : '技术向',
    tags: id % 2 ? ['Agent', '测试'] : ['Agent'],
  },
}))

test('first paint hides every post outside the requested unfiltered page', () => {
  assert.equal(
    blogFirstPaintCss('', BLOG_PAGE_SIZE),
    blogFirstPaintCss('?page=1', BLOG_PAGE_SIZE)
  )
  for (const page of ['0', '-1', '1.5', 'NaN', 'foo']) {
    assert.equal(
      blogFirstPaintCss(`?page=${page}`, BLOG_PAGE_SIZE),
      blogFirstPaintCss('', BLOG_PAGE_SIZE)
    )
  }
  const second = blogFirstPaintCss('?page=2', BLOG_PAGE_SIZE)
  assert.match(
    second,
    /:not\(:nth-child\(n\+8\):nth-child\(-n\+14\)\)\{display:none!important}/
  )
  assert.match(
    second,
    /:nth-child\(n\+8\):nth-child\(-n\+14\)\{display:block!important}/
  )
  assert.equal(
    blogFirstPaintCss('?tag=', BLOG_PAGE_SIZE),
    blogFirstPaintCss('', BLOG_PAGE_SIZE)
  )
  for (const search of [
    '?category=技术向',
    '?tag=Agent',
    '?category=工具向&page=3',
  ]) {
    assert.match(
      blogFirstPaintCss(search, BLOG_PAGE_SIZE),
      /\[data-blog-item\]\{display:none!important}$/
    )
  }
  assert.doesNotMatch(blogFirstPaintBootSource(), /toString|parseBlogQuery/)
  const paintOf = (search) => {
    const style = {
      setAttribute() {
        return undefined
      },
      parentNode: null,
    }
    const root = { dataset: {} }
    vm.runInNewContext(blogFirstPaintBootSource(), {
      URLSearchParams,
      Number,
      String,
      document: {
        documentElement: root,
        createElement: () => style,
        head: {
          querySelector: () => null,
          appendChild(node) {
            node.parentNode = this
          },
        },
      },
      location: { search },
    })
    return { css: style.textContent, paint: root.dataset.blogPaint }
  }
  assert.equal(paintOf('?page=2').css, second)
  assert.equal(paintOf('?page=2').paint, '2')
  assert.equal(paintOf('').paint, '1')
  assert.equal(paintOf('?page=0').paint, '1')
  assert.equal(paintOf('?category=技术向').paint, 'filter')
  assert.equal(
    paintOf('?category=技术向').css,
    blogFirstPaintCss('?category=技术向', BLOG_PAGE_SIZE)
  )
})

test('shared URLs preserve Chinese filters and AND tags without duplicate values', () => {
  const query = parseBlogQuery(
    '?category=技术向&tag=Agent&tag=测试&tag=Agent&page=2'
  )
  assert.deepEqual(parseBlogQuery(serializeBlogQuery(query)), query)
  assert.deepEqual(query.tags, ['Agent', '测试'])
  assert.equal(serializeBlogQuery(parseBlogQuery('')), '')
})

test('untrusted page values cannot produce an empty or partial page by accident', () => {
  for (const page of [
    '-1',
    '0',
    '1.5',
    'NaN',
    'Infinity',
    '1e2',
    '9007199254740992',
  ]) {
    assert.equal(parseBlogQuery(`page=${page}`).page, 1)
  }
  assert.equal(selectBlogPage(posts, parseBlogQuery('page=999')).page, 2)
})

test('seven-post pagination handles empty, exact and partial final pages', () => {
  for (const size of [0, 1, 7, 8, 12, 13]) {
    const result = selectBlogPage(
      posts.slice(0, size),
      parseBlogQuery('page=999')
    )
    assert.equal(result.pageCount, Math.ceil(size / 7))
    assert.equal(result.items.length, size === 0 ? 0 : ((size - 1) % 7) + 1)
  }
})

test('category and every selected tag filter the full collection before pagination', () => {
  const result = selectBlogPage(
    posts,
    parseBlogQuery('category=技术向&tag=Agent&tag=测试')
  )
  assert.deepEqual(
    result.items.map(({ id }) => id),
    [3, 5, 7, 9, 11]
  )
  assert.equal(result.total, 5)
  for (const search of ['category=不存在', 'tag=不存在']) {
    assert.equal(selectBlogPage(posts, parseBlogQuery(search)).total, 0)
  }
  assert.deepEqual(buildCategorySummary(posts), [
    { category: '技术向', count: 11 },
    { category: '工具向', count: 2 },
  ])
})

test('custom categories remain filterable and included in the summary', () => {
  const customPosts = [
    { id: 'custom', data: { category: '思考向', tags: ['Essay'] } },
  ]
  const result = selectBlogPage(customPosts, parseBlogQuery('category=思考向'))

  assert.deepEqual(
    result.items.map(({ id }) => id),
    ['custom']
  )
  assert.deepEqual(buildCategorySummary(customPosts), [
    { category: '思考向', count: 1 },
  ])
})

test('short pagination lists show every page without ellipses', () => {
  assert.deepEqual(getPageNumbers(1, 0), [])
  assert.deepEqual(getPageNumbers(1, 1), [1])
  assert.deepEqual(getPageNumbers(2, 3), [1, 2, 3])
  assert.deepEqual(getPageNumbers(6, 6), [1, 2, 3, 4, 5, 6])
})

test('six-slot pagination shows edge windows and looks ahead in the middle', () => {
  const cases = [
    [1, 7, [1, 2, 3, 4, '…', 7]],
    [4, 7, [1, 2, 3, 4, '…', 7]],
    [5, 7, [1, '…', 4, 5, 6, 7]],
    [4, 8, [1, 2, 3, 4, '…', 8]],
    [5, 8, [1, '…', 5, 6, 7, 8]],
    [1, 10, [1, 2, 3, 4, '…', 10]],
    [4, 10, [1, 2, 3, 4, '…', 10]],
    [5, 10, [1, '…', 5, 6, '…', 10]],
    [6, 10, [1, '…', 6, 7, '…', 10]],
    [7, 10, [1, '…', 7, 8, 9, 10]],
    [10, 10, [1, '…', 7, 8, 9, 10]],
  ]
  for (const [page, count, expected] of cases) {
    assert.deepEqual(getPageNumbers(page, count), expected)
  }
})

test('pagination never hides a single page or loses the current page and endpoints', () => {
  for (let count = 1; count <= 50; count++) {
    for (let page = 1; page <= count; page++) {
      const items = getPageNumbers(page, count)
      assert.equal(items.length, Math.min(count, 6))
      assert.equal(items[0], 1)
      assert.equal(items.at(-1), count)
      assert(items.includes(page))
      if (count > 1) {
        assert(items.includes(page - 1) || items.includes(page + 1))
      }
      for (let i = 1; i < items.length; i++) {
        if (items[i] === '…') {
          assert.equal(typeof items[i - 1], 'number')
          assert.equal(typeof items[i + 1], 'number')
          assert(items[i + 1] - items[i - 1] >= 3)
        } else if (typeof items[i - 1] === 'number') {
          assert.equal(items[i] - items[i - 1], 1)
        }
      }
    }
  }
})
