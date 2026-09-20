import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseBlogQuery,
  serializeBlogQuery,
  selectBlogPage,
  buildCategorySummary,
  getPageNumbers,
} from '../src/utils/blog-browser.js'

const posts = Array.from({ length: 13 }, (_, id) => ({
  id,
  data: {
    category: id < 2 ? '工具向' : '技术向',
    tags: id % 2 ? ['Agent', '测试'] : ['Agent'],
  },
}))

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
  assert.equal(selectBlogPage(posts, parseBlogQuery('page=999')).page, 3)
})

test('six-post pagination handles empty, exact and partial final pages', () => {
  for (const size of [0, 1, 6, 7, 12, 13]) {
    const result = selectBlogPage(
      posts.slice(0, size),
      parseBlogQuery('page=999')
    )
    assert.equal(result.pageCount, Math.ceil(size / 6))
    assert.equal(result.items.length, size === 0 ? 0 : ((size - 1) % 6) + 1)
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

test('page links keep endpoints and current neighbors with gaps indicated', () => {
  assert.deepEqual(getPageNumbers(1, 0), [])
  assert.deepEqual(getPageNumbers(2, 3), [1, 2, 3])
  assert.deepEqual(getPageNumbers(5, 10), [1, '…', 4, 5, 6, '…', 10])
  assert.deepEqual(getPageNumbers(10, 10), [1, '…', 9, 10])
})
