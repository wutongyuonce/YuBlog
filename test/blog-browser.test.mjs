import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import {
  parseBlogQuery,
  serializeBlogQuery,
  selectBlogPage,
  getBlogCategoryColors,
  getCategoryPreviews,
  getPageNumbers,
  blogFirstPaintBootSource,
} from '../src/utils/blog-browser.js'

const posts = Array.from({ length: 13 }, (_, id) => ({
  id,
  data: {
    category: id < 2 ? '工具向' : '技术向',
    tags: id % 2 ? ['Agent', '测试'] : ['Agent'],
  },
}))

test('the injected first-paint script hides posts outside the requested page', () => {
  const paintOf = (search, hash = '') => {
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
      location: { search, hash },
    })
    return { css: style.textContent, paint: root.dataset.blogPaint }
  }
  assert.equal(paintOf('', '#tech').paint, 'filter')
  assert.equal(paintOf('?page=2', '#diary').paint, 'filter')
  assert.equal(paintOf('?page=2', '#thought').paint, 'filter')
  assert.equal(paintOf('', '#旅行').paint, 'filter')
  assert.equal(paintOf('', '#%E6%97%85%E8%A1%8C').paint, 'filter')
  const first = paintOf('')
  assert.equal(first.paint, '1')
  assert.match(
    first.css,
    /:nth-child\(n\+1\):nth-child\(-n\+7\)\{display:block!important}/
  )
  assert.equal(paintOf('?page=1').css, first.css)
  for (const page of ['0', '-1', '1.5', 'NaN', 'foo', '9007199254740992']) {
    assert.equal(paintOf(`?page=${page}`).css, first.css)
    assert.equal(paintOf(`?page=${page}`).paint, '1')
  }
  assert.equal(paintOf('?tag=').css, first.css)

  const second = paintOf('?page=2')
  assert.equal(second.paint, '2')
  assert.match(
    second.css,
    /:not\(:nth-child\(n\+8\):nth-child\(-n\+14\)\)\{display:none!important}/
  )
  assert.match(
    second.css,
    /:nth-child\(n\+8\):nth-child\(-n\+14\)\{display:block!important}/
  )

  for (const search of [
    '?category=技术向',
    '?tag=Agent',
    '?category=工具向&page=3',
  ]) {
    const result = paintOf(search)
    assert.equal(result.paint, 'filter')
    assert.equal(
      result.css,
      '[data-blog-browser]:not([data-paged]) [data-blog-item]{display:none!important}'
    )
  }
})

test('shared URLs preserve Chinese filters and AND tags without duplicate values', () => {
  const query = parseBlogQuery(
    '?category=技术向&tag=Agent&tag=测试&tag=Agent&page=2'
  )
  const url = new URL(serializeBlogQuery(query), 'https://example.test/blogs/')
  assert.deepEqual(parseBlogQuery(url.search, url.hash), query)
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
})

test('custom categories remain filterable by their exact legacy query', () => {
  const customPosts = [
    { id: 'custom', data: { category: '思考向', tags: ['Essay'] } },
  ]
  const result = selectBlogPage(customPosts, parseBlogQuery('category=思考向'))

  assert.deepEqual(
    result.items.map(({ id }) => id),
    ['custom']
  )
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

test('new fragment categories round-trip with tags and pages; legacy queries still work', () => {
  const query = parseBlogQuery('?tag=Agent&page=2', '#tech')
  assert.deepEqual(query, { category: '技术', tags: ['Agent'], page: 2 })
  const url = new URL(serializeBlogQuery(query), 'https://example.test/blogs/')
  assert.equal(url.hash, '#%E6%8A%80%E6%9C%AF')
  assert.equal(url.searchParams.has('category'), false)
  assert.deepEqual(parseBlogQuery(url.search, url.hash), query)
  assert.equal(parseBlogQuery('?category=技术向', '#diary').category, '日记')
  assert.equal(
    parseBlogQuery('?category=技术向', '#unknown').category,
    'unknown'
  )
  assert.equal(parseBlogQuery('', '#%broken').category, '')
  assert.equal(parseBlogQuery('?category=旅行', '#%broken').category, '旅行')
})

test('categories filter by exact frontmatter values without merging aliases', () => {
  const entries = [
    { id: 'tools', data: { category: '工具向', tags: ['Agent'] } },
    { id: 'tech', data: { category: '技术', tags: ['Agent'] } },
    { id: 'essay', data: { category: '思考', tags: [] } },
    { id: 'diary', data: { category: '日记', tags: [] } },
    { id: 'custom', data: { category: '自定义', tags: [] } },
  ]
  assert.deepEqual(
    selectBlogPage(entries, parseBlogQuery('', '#tech')).items.map(
      ({ id }) => id
    ),
    ['tech']
  )
  assert.deepEqual(
    selectBlogPage(entries, parseBlogQuery('?category=工具向')).items.map(
      ({ id }) => id
    ),
    ['tools']
  )
  assert.deepEqual(
    selectBlogPage(entries, parseBlogQuery('', '#thought')).items.map(
      ({ id }) => id
    ),
    ['essay']
  )
  assert.deepEqual(
    selectBlogPage(entries, parseBlogQuery('', '#diary')).items.map(
      ({ id }) => id
    ),
    ['diary']
  )
  assert.equal(
    serializeBlogQuery({ category: '思考', tags: [], page: 1 }),
    '#%E6%80%9D%E8%80%83'
  )
  assert.equal(
    selectBlogPage(entries, parseBlogQuery('?tag=Missing', '#tech')).total,
    0
  )
})

test('navigation previews count published groups and show at most four in supplied date order', () => {
  const entries = [
    ...Array.from({ length: 6 }, (_, id) => ({
      id,
      data: { category: id % 2 ? '技术向' : '工具向' },
    })),
    { id: 'thought', data: { category: '思考向' } },
    { id: 'diary', data: { category: '日记' } },
    { id: 'custom', data: { category: '自定义' } },
  ]
  const groups = getCategoryPreviews(entries)
  assert.equal(groups.length, 5, 'raw category names remain separate')
  for (const category of ['技术向', '工具向']) {
    const group = groups.find(({ label }) => label === category)
    assert.equal(group.count, 3)
    assert.deepEqual(
      group.posts.map(({ id }) => id),
      category === '技术向' ? [1, 3, 5] : [0, 2, 4]
    )
  }
  assert.deepEqual(getCategoryPreviews([]), [], 'no fixed empty categories')
})

test('arbitrary category names share fragment URLs without reserved-name or encoding collisions', () => {
  for (const category of [
    '旅行',
    'English',
    'tech',
    'thought',
    'diary',
    'category=tech',
    'toString',
    '__proto__',
    'C++ / C# & 100%',
    '<script>',
    '👩‍💻',
  ]) {
    const query = { category, tags: ['随笔'], page: 2 }
    const url = new URL(
      serializeBlogQuery(query),
      'https://example.test/blogs/'
    )
    assert.equal(url.searchParams.has('category'), false)
    assert.deepEqual(parseBlogQuery(url.search, url.hash), query)
    assert.equal(
      selectBlogPage(
        [{ data: { category, tags: ['随笔'] } }],
        parseBlogQuery(url.search, url.hash)
      ).total,
      1
    )
  }
  assert.equal(
    serializeBlogQuery({ category: '旅行', tags: [], page: 1 }),
    '#%E6%97%85%E8%A1%8C'
  )
  const legacy = parseBlogQuery('?category=工具向')
  const url = new URL(serializeBlogQuery(legacy), 'https://example.test/blogs/')
  assert.deepEqual(
    selectBlogPage(posts, parseBlogQuery(url.search, url.hash)).items.map(
      ({ id }) => id
    ),
    [0, 1]
  )
})

test('published custom categories are discovered once with counts and bounded date-ordered previews', () => {
  const entries = [
    ...Array.from({ length: 9 }, (_, id) => ({
      id,
      data: { category: '旅行' },
    })),
    { id: 'reading-1', data: { category: '读书' } },
    { id: 'reading-2', data: { category: '读书' } },
    { id: 'tools', data: { category: '工具向' } },
  ]
  const groups = getCategoryPreviews(entries)
  assert.deepEqual(
    groups.map(({ label, count }) => [label, count]),
    [
      ['旅行', 9],
      ['读书', 2],
      ['工具向', 1],
    ]
  )
  assert.equal(groups.length, 3)
  const travel = groups.find(({ label }) => label === '旅行')
  assert.equal(travel.count, 9)
  assert.deepEqual(
    travel.posts.map(({ id }) => id),
    [0, 1, 2, 3]
  )
  assert.equal(parseBlogQuery('', '#' + travel.id).category, '旅行')
  assert.deepEqual(
    getCategoryPreviews([...entries].reverse()).map(({ label }) => label),
    groups.map(({ label }) => label)
  )
  assert.equal(
    getCategoryPreviews(
      entries.filter(({ data }) => data.category !== '旅行')
    ).some(({ label }) => label === '旅行'),
    false
  )
})

test('equally populated categories sort by name regardless of article order', () => {
  const entries = [{ data: { category: '安' } }, { data: { category: '阿' } }]
  assert.deepEqual(
    getCategoryPreviews(entries).map(({ label }) => label),
    ['阿', '安']
  )
  assert.deepEqual(
    getCategoryPreviews([...entries].reverse()).map(({ label }) => label),
    ['阿', '安']
  )
})

test('raw category names receive stable theme colors without CSS injection', () => {
  const colors = getBlogCategoryColors('旅行')
  for (const name of [
    '技术',
    '思考',
    '日记',
    '读书',
    '旅行',
    '旅行; color: red',
    '👩‍💻',
  ]) {
    const { light, dark } = getBlogCategoryColors(name)
    for (const color of [light, dark]) {
      assert.match(
        color,
        /^hsl\(\d+ \d+% \d+%\)$/,
        'all category names use the generated palette without CSS injection or fixed overrides'
      )
    }
  }
  assert.deepEqual(getBlogCategoryColors('旅行'), colors)
  assert.notEqual(colors.light, colors.dark)
})
