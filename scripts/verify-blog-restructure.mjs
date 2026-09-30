import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fromHtml } from 'hast-util-from-html'
import { visit } from 'unist-util-visit'
import { XMLParser } from 'fast-xml-parser'

const load = async (file) =>
  fromHtml(await readFile(new URL(`../dist/${file}`, import.meta.url), 'utf8'))
const [home, blogs, interests, about, article, ...otherPages] =
  await Promise.all(
    [
      'index.html',
      'blogs/index.html',
      'interests/index.html',
      'about/index.html',
      'blogs/browser-use/index.html',
      'archives/index.html',
      'tags/index.html',
      'projects/index.html',
      'friends/index.html',
    ].map(load)
  )
const elements = (tree, predicate) => {
  const found = []
  visit(tree, 'element', (node) => {
    if (predicate(node)) found.push(node)
  })
  return found
}
const hasClass = (node, name) => node.properties.className?.includes(name)

test('section children have the correct parent selected before client scripts run', async () => {
  const book = await load('interests/book/index.html')
  for (const [page, href] of [
    [blogs, '/blogs/'],
    [article, '/blogs/'],
    [interests, '/interests/'],
    [book, '/interests/'],
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

test('friend recommendations are separate from exchanged links and the removed link is absent', () => {
  const friends = otherPages[3]
  const groups = elements(friends, (node) => hasClass(node, 'friends-group'))
  assert.equal(groups.length, 2)
  const headings = groups.map(
    (group) =>
      elements(group, (node) => node.tagName === 'h2')[0].children[0].value
  )
  assert.deepEqual(headings, ['推荐', '双向'])
  const links = groups.map((group) =>
    elements(group, (node) => hasClass(node, 'friend-card')).map(
      (node) => node.properties.href
    )
  )
  assert.deepEqual(links[0], [
    'https://antfu.me/',
    'https://www.pseudoyu.com/',
    'https://www.ruanyifeng.com/blog/',
    'https://lucumr.pocoo.org/',
  ])
  assert.equal(links[1].length, 16)
  assert.equal(new Set(links.flat()).size, 20)
  assert.ok(!links.flat().includes('https://www.tcdw.net'))
})

test('desktop articles expose the TOC directly with no disclosure button', () => {
  const aside = elements(
    article,
    (node) => node.properties.id === 'desktop-aside'
  )[0]
  assert.equal(elements(aside, (node) => node.tagName === 'button').length, 0)
  assert.equal(
    elements(aside, (node) => node.properties.id === 'toc-sidebar').length,
    1
  )
})

test('home social links preserve the about-page identities and add the real email', () => {
  const nav = elements(home, (node) =>
    hasClass(node, 'blog-profile__social')
  )[0]
  const hrefs = elements(nav, (node) => node.tagName === 'a').map(
    (node) => node.properties.href
  )
  const aboutHrefs = new Set(
    elements(about, (node) => node.tagName === 'a').map(
      (node) => node.properties.href
    )
  )
  assert.equal(hrefs.length, 6)
  for (const href of hrefs.filter((href) => !href.startsWith('mailto:')))
    assert.ok(aboutHrefs.has(href), href)
  assert.ok(hrefs.includes('mailto:18896680730@163.com'))
})

test('archive preserves one chronological timeline and labels the shared categories', () => {
  const archive = otherPages[0]
  assert.equal(
    elements(archive, (node) => hasClass(node, 'archive-timeline')).length,
    1
  )
  for (const [slug, category] of [
    ['browser-use', '技术'],
    ['east-asian-meritocracy', '思考'],
    ['intj-antifragile', '思考'],
    ['diary-placeholder', '日记'],
  ]) {
    const post = elements(
      archive,
      (node) =>
        hasClass(node, 'archive-post') &&
        elements(node, (child) => child.properties.href === `/blogs/${slug}/`)
          .length
    )[0]
    assert.equal(post.properties.dataCategory, category)
    assert.equal(
      elements(post, (node) => hasClass(node, 'archive-post__category'))[0]
        .children[0].value,
      category
    )
  }
})

test('all pages omit the personal sidebar; only home contains a profile', () => {
  for (const page of [home, blogs, interests, about, article, ...otherPages]) {
    assert.equal(
      elements(
        page,
        (node) =>
          hasClass(node, 'blog-sidebar') ||
          hasClass(node, 'blog-index-sidebar-column')
      ).length,
      0
    )
    assert.equal(
      elements(page, (node) => 'dataSiteHeader' in node.properties).length,
      1
    )
    if (page !== home)
      assert.equal(
        elements(page, (node) => hasClass(node, 'blog-profile')).length,
        0
      )
  }
})

test('home is a landing page, manuscripts own pagination, and articles have no profile', () => {
  assert.equal(
    elements(home, (node) => hasClass(node, 'blog-profile')).length,
    1
  )
  assert.equal(
    elements(home, (node) => hasClass(node, 'recent-writing__item')).length,
    5
  )
  assert.equal(
    elements(home, (node) => 'dataBlogBrowser' in node.properties).length,
    0
  )
  assert.equal(
    elements(home, (node) => hasClass(node, 'blog-sidebar')).length,
    0
  )
  assert.equal(
    elements(blogs, (node) => 'dataBlogBrowser' in node.properties).length,
    1
  )
  assert.equal(
    elements(blogs, (node) => hasClass(node, 'recent-writing')).length,
    0
  )
  assert.equal(
    elements(article, (node) => hasClass(node, 'blog-profile')).length,
    0
  )
  assert.ok(
    elements(
      article,
      (node) => node.tagName === 'a' && node.properties.href === '/blogs/'
    ).length
  )
})

test('navigation previews only published articles and respects the four-post bound', async () => {
  const xml = await readFile(
    new URL('../dist/rss.xml', import.meta.url),
    'utf8'
  )
  const feed = new XMLParser().parse(xml).rss.channel.item
  const publishedLinks = new Set(feed.map(({ link }) => link))
  const previews = elements(home, (node) =>
    hasClass(node, 'nav-dropdown__preview')
  )
  assert.equal(previews.length, 3)
  const thoughtLinks = elements(
    previews[1],
    (node) => node.tagName === 'a'
  ).map((node) => node.properties.href)
  assert.deepEqual(thoughtLinks, [
    '/blogs/east-asian-meritocracy/',
    '/blogs/intj-antifragile/',
  ])
  assert.deepEqual(
    elements(previews[2], (node) => node.tagName === 'a').map(
      (node) => node.properties.href
    ),
    ['/blogs/diary-placeholder/']
  )
  for (const preview of previews) {
    const links = elements(preview, (node) => node.tagName === 'a')
    assert.ok(links.length <= 4)
    for (const {
      properties: { href },
    } of links)
      assert.ok(
        publishedLinks.has(new URL(href, 'https://www.wutongyu.site/').href),
        `Preview must be published: ${href}`
      )
  }
})

test('all seven interest links resolve to independent content pages; about has no old tabs', async () => {
  const ids = ['device', 'anime', 'movie', 'tv', 'game', 'book', 'kpop']
  const titles = ['设备', '动漫', '电影', '电视剧', '游戏', '书', 'Kpop']
  const menu = elements(
    home,
    (node) => node.properties.id === 'nav-menu-interests'
  )[0]
  const urls = ids.map((id) => `/interests/${id}/`)
  assert.deepEqual(
    elements(menu, (node) => node.tagName === 'a').map(
      (node) => node.properties.href
    ),
    urls
  )
  const index = elements(interests, (node) =>
    hasClass(node, 'interests-page__index')
  )[0]
  assert.deepEqual(
    elements(index, (node) => node.tagName === 'a').map(
      (node) => node.properties.href
    ),
    urls
  )
  assert.equal(
    elements(interests, (node) => 'dataInterest' in node.properties).length,
    0
  )
  for (const [position, id] of ids.entries()) {
    const page = await load(`interests/${id}/index.html`)
    const content = elements(page, (node) => 'dataInterest' in node.properties)
    assert.equal(content.length, 1)
    assert.equal(content[0].properties.dataInterest, id)
    const title = elements(page, (node) => node.tagName === 'h1')[0]
    assert.equal(title.children[0].value, titles[position])
    assert.equal(
      elements(page, (node) => hasClass(node, 'blog-profile')).length,
      0
    )
    const currentLink = elements(
      page,
      (node) =>
        node.properties.ariaCurrent === 'page' &&
        node.properties.href === '/interests/'
    )
    assert.equal(currentLink.length, 1)
  }
  assert.equal(
    elements(
      about,
      (node) =>
        node.properties.role === 'tablist' ||
        node.properties.role === 'tabpanel'
    ).length,
    0
  )
  assert.equal(
    elements(about, (node) => hasClass(node, 'about-panel')).length,
    1
  )
})

test('cover articles keep one standalone heading and a descriptive author cover', async () => {
  for (const slug of ['browser-use', 'east-asian-meritocracy']) {
    const page = await load(`blogs/${slug}/index.html`)
    const header = elements(page, (node) => hasClass(node, 'post-header'))[0]
    assert.equal(elements(header, (node) => node.tagName === 'h1').length, 1)
    assert.equal(
      elements(header, (node) => hasClass(node, 'page-title')).length,
      1
    )
    const hero = elements(header, (node) => hasClass(node, 'post-hero'))[0]
    assert.ok(hero, 'The cover remains below the standalone heading')
    assert.equal(elements(hero, (node) => node.tagName === 'h1').length, 0)
    assert.equal(
      elements(hero, (node) => hasClass(node, 'post-hero__subtitle')).length,
      1
    )
    const meta = elements(hero, (node) => hasClass(node, 'post-meta--hero'))[0]
    const text = (node) =>
      node.type === 'text'
        ? node.value
        : (node.children || []).map(text).join('')
    assert.match(text(meta), /梧桐雨/)
    assert.doesNotMatch(text(meta), /min read|Agent \/|Updated/)
    assert.equal(
      elements(meta, (node) => hasClass(node, 'post-meta__avatar')).length,
      1
    )
    assert.equal(elements(meta, (node) => node.tagName === 'time').length, 1)
  }
})
