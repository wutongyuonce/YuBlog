import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { fromHtml } from 'hast-util-from-html'
import { visit } from 'unist-util-visit'
import { XMLParser } from 'fast-xml-parser'
import {
  AUTHOR_LINKS,
  INTEREST_ICONS,
  MORE_LINKS,
  SITE,
} from '../src/config.ts'
import {
  getBlogCategoryColors,
  parseBlogQuery,
} from '../src/utils/blog-browser.js'

const load = async (file) =>
  fromHtml(await readFile(new URL(`../dist/${file}`, import.meta.url), 'utf8'))
const [home, blogs, interests, about, archives, tags, projects, friends] =
  await Promise.all(
    [
      'index.html',
      'blogs/index.html',
      'interests/index.html',
      'about/index.html',
      'archives/index.html',
      'tags/index.html',
      'projects/index.html',
      'friends/index.html',
    ].map(load)
  )
const articleFiles = (
  await readdir(new URL('../dist/blogs/', import.meta.url), { recursive: true })
).filter((file) => file.endsWith('/index.html'))
const articles = await Promise.all(
  articleFiles.map((file) => load(`blogs/${file}`))
)
const pages = [
  home,
  blogs,
  interests,
  about,
  archives,
  tags,
  projects,
  friends,
  ...articles,
]
const elements = (tree, predicate) => {
  const found = []
  visit(tree, 'element', (node) => {
    if (predicate(node)) found.push(node)
  })
  return found
}
const hasClass = (node, name) => node.properties.className?.includes(name)
const textOf = (node) =>
  node.type === 'text' ? node.value : (node.children || []).map(textOf).join('')

test('deployment preserves the manuscript route', async () => {
  const { redirects = [] } = JSON.parse(
    await readFile(new URL('../vercel.json', import.meta.url), 'utf8')
  )
  for (const pathname of ['/blogs', '/blogs/']) {
    const redirect = redirects.find(({ source }) => source === pathname)
    if (redirect)
      assert.equal(
        new URL(redirect.destination, SITE.website).pathname,
        '/blogs/',
        'Manuscripts and category bookmarks must not redirect to home'
      )
  }
})

test('section pages select the correct navigation parent before scripts run', () => {
  for (const [page, href] of [
    [blogs, '/blogs/'],
    ...articles.map((page) => [page, '/blogs/']),
    [interests, '/interests/'],
    [friends, '/friends/'],
  ]) {
    const current = elements(
      page,
      (node) =>
        'dataNavLink' in node.properties &&
        node.properties.ariaCurrent === 'page'
    )
    assert.deepEqual(
      current.map((node) => node.properties.href),
      [href]
    )
  }
})

test('More follows configuration and safely marks external destinations', () => {
  for (const page of pages) {
    const menu = elements(
      page,
      (node) => node.properties.id === 'nav-menu-more'
    )[0]
    assert.ok(menu, 'Every navigation includes More')
    const links = elements(menu, (node) => node.tagName === 'a')
    assert.deepEqual(
      links.map((node) => node.properties.href),
      MORE_LINKS.map(({ href }) => href)
    )
    for (const [index, config] of MORE_LINKS.entries()) {
      if (!config.external) continue
      assert.equal(links[index].properties.target, '_blank')
      assert.ok(links[index].properties.rel?.includes('noopener'))
      assert.ok(links[index].properties.rel?.includes('noreferrer'))
      assert.ok(
        elements(links[index], (node) =>
          hasClass(node, 'nav-dropdown__external')
        ).length
      )
    }
    assert.equal(
      elements(menu, (node) => 'dataNavLink' in node.properties).length,
      0,
      'Submenu links must not become top-level indicator targets'
    )
  }
})

test('friend groups render the current data without dropping entries', async () => {
  const source = JSON.parse(
    await readFile(
      new URL('../src/content/friends/data.json', import.meta.url),
      'utf8'
    )
  ).sort(
    (a, b) =>
      (a.order ?? 999) - (b.order ?? 999) ||
      a.name.localeCompare(b.name, 'zh-Hans-CN')
  )
  const groups = elements(friends, (node) => hasClass(node, 'friends-group'))
  const headings = groups.map((group) =>
    textOf(elements(group, (node) => node.tagName === 'h2')[0])
  )
  assert.deepEqual(headings, source.length ? ['推荐', '双向'] : [])
  const links = groups.map((group) =>
    elements(group, (node) => hasClass(node, 'friend-card')).map(
      (node) => node.properties.href
    )
  )
  for (const [index, category] of headings.entries()) {
    assert.deepEqual(
      links[index],
      source
        .filter((entry) => entry.category === category)
        .map((entry) => entry.link)
    )
  }
  assert.equal(links.flat().length, source.length)
})

test('desktop articles expose an authored TOC directly', () => {
  for (const article of articles) {
    const aside = elements(
      article,
      (node) => node.properties.id === 'desktop-aside'
    )[0]
    if (!aside) continue // Articles may disable TOC or have no eligible headings.
    assert.equal(elements(aside, (node) => node.tagName === 'button').length, 0)
    assert.equal(
      elements(aside, (node) => node.properties.id === 'toc-sidebar').length,
      1
    )
  }
})

test('home social links follow author configuration independently of about content', () => {
  const nav = elements(home, (node) =>
    hasClass(node, 'blog-profile__social')
  )[0]
  assert.ok(nav)
  const hrefs = elements(nav, (node) => node.tagName === 'a').map(
    (node) => node.properties.href
  )
  assert.deepEqual(
    hrefs,
    AUTHOR_LINKS.map(({ href }) => href)
  )
})

test('list and archive preserve raw category labels on a single timeline', () => {
  const listedPosts = elements(
    blogs,
    (node) => 'dataBlogItem' in node.properties
  )
  for (const post of listedPosts) {
    const category = elements(
      post,
      (node) => 'dataBlogCategory' in node.properties
    )[0]
    assert.equal(textOf(category).trim(), post.properties.dataCategory)
    assert.equal(
      category.properties.dataBlogCategory,
      post.properties.dataCategory
    )
  }
  assert.deepEqual(
    elements(archives, (node) => hasClass(node, 'archive-post'))
      .map((node) => node.properties.dataCategory)
      .sort(),
    listedPosts.map((node) => node.properties.dataCategory).sort()
  )
  assert.equal(
    elements(archives, (node) => hasClass(node, 'archive-timeline')).length,
    1
  )
  for (const post of elements(archives, (node) =>
    hasClass(node, 'archive-post')
  )) {
    assert.equal(
      textOf(
        elements(post, (node) => hasClass(node, 'archive-post__category'))[0]
      ),
      post.properties.dataCategory
    )
  }
})

test('home is the landing page and manuscripts own the full article list', () => {
  for (const page of pages) {
    assert.equal(
      elements(page, (node) => 'dataSiteHeader' in node.properties).length,
      1
    )
    assert.equal(
      elements(page, (node) => hasClass(node, 'blog-profile')).length,
      page === home ? 1 : 0
    )
  }
  assert.equal(
    elements(home, (node) => hasClass(node, 'recent-writing__item')).length,
    Math.min(5, articles.length)
  )
  assert.equal(
    elements(home, (node) => 'dataBlogBrowser' in node.properties).length,
    0
  )
  assert.equal(
    elements(blogs, (node) => 'dataBlogBrowser' in node.properties).length,
    1
  )
  assert.equal(
    elements(blogs, (node) => 'dataBlogItem' in node.properties).length,
    articles.length
  )
  for (const article of articles)
    assert.ok(
      elements(
        article,
        (node) => node.tagName === 'a' && node.properties.href === '/blogs/'
      ).length
    )
})

test('navigation previews count current categories and only link published articles', async () => {
  const xml = await readFile(
    new URL('../dist/rss.xml', import.meta.url),
    'utf8'
  )
  const feed = [].concat(new XMLParser().parse(xml).rss.channel.item || [])
  const publishedLinks = new Set(feed.map(({ link }) => link))
  const previews = elements(home, (node) =>
    hasClass(node, 'nav-dropdown__preview')
  )
  const categories = elements(home, (node) =>
    hasClass(node, 'nav-dropdown__category-link')
  )
  const archivedPosts = elements(archives, (node) =>
    hasClass(node, 'archive-post')
  )
  const counts = new Map()
  for (const post of archivedPosts) {
    const category = post.properties.dataCategory
    counts.set(category, (counts.get(category) ?? 0) + 1)
    const colors = getBlogCategoryColors(category)
    assert.ok(
      post.properties.style.includes(
        `--archive-category-light: ${colors.light}`
      )
    )
    assert.ok(
      post.properties.style.includes(`--archive-category-dark: ${colors.dark}`)
    )
  }
  assert.equal(categories.length, counts.size)
  assert.equal(previews.length, counts.size)
  const seen = new Set()
  for (const category of categories) {
    const url = new URL(category.properties.href, SITE.website)
    const label = parseBlogQuery(url.search, url.hash).category
    assert.equal(url.pathname, '/blogs/')
    assert.equal(url.searchParams.has('category'), false)
    assert.ok(!seen.has(label), 'Each category has exactly one menu entry')
    seen.add(label)
    const spans = elements(category, (node) => node.tagName === 'span')
    assert.equal(textOf(spans[0]), label)
    assert.equal(Number(textOf(spans[1])), counts.get(label))
  }
  assert.deepEqual(
    [...seen],
    [...counts.keys()].sort(
      (a, b) =>
        counts.get(b) - counts.get(a) || a.localeCompare(b, 'zh-Hans-CN')
    ),
    'only published categories appear, ordered by count then name'
  )
  for (const preview of previews) {
    const links = elements(preview, (node) => node.tagName === 'a')
    assert.ok(links.length <= 4)
    for (const {
      properties: { href },
    } of links)
      assert.ok(
        publishedLinks.has(new URL(href, SITE.website).href),
        `Preview must be published: ${href}`
      )
  }
})

test('interest menu and index agree and their links resolve to content pages', async () => {
  const menu = elements(
    home,
    (node) => node.properties.id === 'nav-menu-interests'
  )[0]
  const index = elements(interests, (node) =>
    hasClass(node, 'interests-page__index')
  )[0]
  assert.ok(menu)
  assert.ok(index)
  const indexLinks = elements(index, (node) => node.tagName === 'a')
  const menuLinks = elements(menu, (node) => node.tagName === 'a')
  assert.deepEqual(
    menuLinks.map((node) => node.properties.href),
    indexLinks.map((node) => node.properties.href)
  )
  const sourceFiles = (
    await readdir(new URL('../src/content/interests/', import.meta.url))
  ).filter(
    (file) =>
      /\.(md|mdx)$/.test(file) && !['intro.md', 'recent.md'].includes(file)
  )
  assert.equal(indexLinks.length, sourceFiles.length)
  for (const link of indexLinks) {
    const pathname = new URL(link.properties.href, SITE.website).pathname
    const page = await load(`${pathname.slice(1)}index.html`)
    const id = decodeURIComponent(pathname.split('/').filter(Boolean).at(-1))
    const menuLink = menuLinks.find(
      (node) => node.properties.href === link.properties.href
    )
    const icons = elements(menuLink, (node) =>
      hasClass(node, 'nav-dropdown__icon')
    )
    assert.equal(
      icons.length,
      INTEREST_ICONS[id] ? 1 : 0,
      `${id}: unconfigured icons leave no placeholder`
    )
    if (INTEREST_ICONS[id]) assert.ok(hasClass(icons[0], INTEREST_ICONS[id]))
    const content = elements(page, (node) => 'dataInterest' in node.properties)
    assert.equal(content.length, 1)
    assert.equal(content[0].properties.dataInterest, id)
    const title = elements(page, (node) => node.tagName === 'h1')[0]
    assert.equal(
      textOf(title),
      textOf(elements(link, (node) => node.tagName === 'span')[0])
    )
    assert.equal(
      elements(
        page,
        (node) =>
          node.properties.ariaCurrent === 'page' &&
          node.properties.href === '/interests/'
      ).length,
      1
    )
  }
})

test('article covers do not replace the standalone page heading', () => {
  for (const page of articles) {
    const header = elements(page, (node) => hasClass(node, 'post-header'))[0]
    assert.ok(header)
    assert.equal(elements(header, (node) => node.tagName === 'h1').length, 1)
    const hero = elements(header, (node) => hasClass(node, 'post-hero'))[0]
    if (!hero) continue // A cover and its description are optional authored data.
    assert.equal(elements(hero, (node) => node.tagName === 'h1').length, 0)
    const cover = elements(
      hero,
      (node) => node.tagName === 'img' && !hasClass(node, 'post-meta__avatar')
    )[0]
    assert.ok(
      cover?.properties.alt?.trim(),
      'Authored covers need descriptive alt text'
    )
  }
})
