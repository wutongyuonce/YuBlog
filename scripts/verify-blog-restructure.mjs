import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { fromHtml } from 'hast-util-from-html'
import { visit } from 'unist-util-visit'
import { XMLParser } from 'fast-xml-parser'
import { parse as parseCss, walk as walkCss } from 'css-tree'
import {
  AUTHOR_LINKS,
  FEATURES,
  GISCUS,
  INTEREST_ICONS,
  MORE_LINKS,
  SITE,
} from '../src/config.ts'
import { parseBlogQuery } from '../src/utils/blog-browser.js'
import { getBlogCategoryColors } from '../src/utils/blog-category-colors.js'

const siteBase = new URL(
  SITE.base.endsWith('/') ? SITE.base : `${SITE.base}/`,
  SITE.website
)
const sitePath = (path) => new URL(path.replace(/^\//, ''), siteBase).pathname

const load = async (file) =>
  fromHtml(await readFile(new URL(`../dist/${file}`, import.meta.url), 'utf8'))
const pageFiles = [
  'index.html',
  'blogs/index.html',
  'interests/index.html',
  'about/index.html',
  'archives/index.html',
  'tags/index.html',
  'projects/index.html',
  'friends/index.html',
]
const [home, blogs, interests, about, archives, tags, projects, friends] =
  await Promise.all(pageFiles.map(load))
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

function assertBodyToc(page, body, label) {
  assert.ok(body, `${label}: body exists`)
  const { toc } = FEATURES
  const headings =
    Array.isArray(toc) && toc[0]
      ? elements(body, (node) => {
          const depth = /^h([1-6])$/.exec(node.tagName)?.[1]
          return (
            depth &&
            Number(depth) >= toc[1].minHeadingLevel &&
            Number(depth) <= toc[1].maxHeadingLevel
          )
        })
      : []
  assert.equal(
    elements(page, (node) => node.tagName === 'table-of-contents').length,
    headings.length ? 1 : 0,
    `${label}: render a directory only for eligible body headings`
  )
  for (const containerId of ['toc-sidebar', 'mobile-toc-panel']) {
    const container = elements(
      page,
      (node) => node.properties.id === containerId
    )[0]
    const links = container
      ? elements(container, (node) => 'dataTocLink' in node.properties)
      : []
    assert.deepEqual(
      links.map((node) => node.properties.href),
      headings.map((node) => `#${node.properties.id}`),
      `${label}: ${containerId} follows body heading order and targets`
    )
  }
}

test('home ships its own layout and background rules inline', () => {
  // Delivery itself (no external sheet, no @import, theme tokens inline) is owned
  // by the per-page check below; this test owns the homepage-specific rules.
  const head = elements(home, (node) => node.tagName === 'head')[0]
  const css = elements(head, (node) => node.tagName === 'style')
    .map(textOf)
    .join('\n')
  assert.match(
    css,
    /\.home-page\b/,
    'the homepage layout arrives with the document'
  )
  assert.match(
    css,
    /\.fixed\s*\{/,
    'the background positioning arrives with the document'
  )
})

test('every page delivers its styles with the document', async () => {
  // Splitting CSS per page means each page carries a different set of blocks;
  // asserting only the homepage would let a page lose its styles silently.
  // Article pages are the one exception: ExpressiveCode ships its own sheet.
  const built = [
    ...pageFiles.map((file, index) => ({ page: pages[index], file })),
    ...articleFiles.map((file, index) => ({
      page: articles[index],
      file: `blogs/${file}`,
    })),
    {
      page: fromHtml(
        await readFile(new URL('../dist/404.html', import.meta.url), 'utf8')
      ),
      file: '404.html',
    },
    ...(await Promise.all(
      (
        await readdir(new URL('../dist/interests/', import.meta.url), {
          recursive: true,
        })
      )
        .filter((file) => file.endsWith('/index.html'))
        .map(async (file) => ({
          page: fromHtml(
            await readFile(
              new URL(`../dist/interests/${file}`, import.meta.url),
              'utf8'
            )
          ),
          file: `interests/${file}`,
        }))
    )),
  ]
  let sharedCss
  for (const { page, file } of built) {
    const links = elements(
      page,
      (node) =>
        node.tagName === 'link' && node.properties.rel?.includes('stylesheet')
    )
    for (const link of links)
      assert.match(
        String(link.properties.href),
        /\/_astro\/ec\./,
        `${file}: only the pre-existing code-block sheet may stay external`
      )
    const styles = elements(
      elements(page, (node) => node.tagName === 'head')[0],
      (node) => node.tagName === 'style'
    )
    const shared = styles.filter((node) => node.properties.id === 'site-styles')
    assert.equal(shared.length, 1, `${file}: one shared stylesheet`)
    sharedCss ??= textOf(shared[0])
    assert.equal(
      textOf(shared[0]),
      sharedCss,
      `${file}: shared CSS is page-independent`
    )
    const css = styles.map(textOf).join('\n')
    assert.doesNotMatch(
      css,
      /@import\b|__VITE_ASSET|__VITE_PUBLIC_ASSET/i,
      `${file}: processed CSS and resources`
    )
    assert.match(
      sharedCss,
      /--c-bg\s*:/,
      `${file}: shared theme tokens arrive inline`
    )
    for (const style of styles.filter((node) => node !== shared[0]))
      assert.doesNotMatch(
        textOf(style),
        /--c-bg\s*:/,
        `${file}: shared styles are not bundled twice`
      )
  }
  for (const selector of ['.site-main', '.prose', '.katex', '.callout'])
    assert.ok(sharedCss.includes(selector), `shared CSS includes ${selector}`)
  const assets = new Set()
  walkCss(parseCss(sharedCss), (node) => {
    if (node.type === 'Url' && node.value.startsWith('/'))
      assets.add(node.value)
  })
  for (const asset of assets)
    await access(
      new URL(
        '../dist/' + asset.replace(siteBase.pathname, ''),
        import.meta.url
      )
    )
})

test('only articles, friends and every interest category have isolated comments after their content', async () => {
  const interestFiles = (
    await readdir(new URL('../dist/interests/', import.meta.url), {
      recursive: true,
    })
  ).filter((file) => file.endsWith('/index.html'))
  const interestPages = await Promise.all(
    interestFiles.map((file) => load('interests/' + file))
  )
  const enabled = [friends, ...articles, ...interestPages]
  const terms = new Set()
  for (const page of [...pages, ...interestPages]) {
    const roots = elements(page, (node) => node.tagName === 'giscus-comments')
    assert.equal(roots.length, enabled.includes(page) ? 1 : 0)
    if (!roots.length) continue
    const root = roots[0]
    const template = elements(root, (node) => node.tagName === 'template')[0]
    const widgets = elements(
      template.content,
      (node) => node.tagName === 'giscus-widget'
    )
    assert.equal(widgets.length, 1)
    const config = widgets[0].properties
    const canonical = elements(
      page,
      (node) =>
        node.tagName === 'link' && node.properties.rel?.includes('canonical')
    )[0].properties.href
    assert.equal(config.term, new URL(canonical).pathname)
    assert.equal(config.mapping, 'specific')
    assert.equal(config.strict, '1')
    assert.equal(config.repo, GISCUS.repo)
    assert.equal(config.repoid, GISCUS.repoId)
    assert.equal(config.categoryid, GISCUS.categoryId)
    assert.ok(!terms.has(config.term), 'Each page owns its discussion')
    terms.add(config.term)
    assert.equal(
      elements(
        page,
        (node) =>
          node.tagName === 'meta' && node.properties.name === 'giscus:backlink'
      )[0].properties.content,
      canonical
    )
    for (const body of elements(page, (node) =>
      hasClass(node, 'markdown-content')
    )) {
      assert.equal(
        elements(body, (node) => node.tagName === 'giscus-comments').length,
        0,
        'Comments must stay outside authored content and RSS'
      )
      assert.ok(
        body.position.end.offset < root.position.start.offset,
        'Comments follow the body'
      )
    }
    if (articles.includes(page)) {
      const body = elements(page, (node) => hasClass(node, 'post-content'))[0]
      const nav = elements(page, (node) => hasClass(node, 'post-nav'))[0]
      const main = elements(page, (node) => node.tagName === 'main')[0]
      assert.equal(
        main.children.some((node) => node.tagName === 'footer'),
        false,
        'Article content flows directly into navigation and comments'
      )
      assert.ok(
        body.position.end.offset < root.position.start.offset,
        'Comments follow the article'
      )
      if (nav) {
        assert.ok(
          body.position.end.offset < nav.position.start.offset &&
            nav.position.end.offset < root.position.start.offset,
          'Article navigation sits between body and comments'
        )
        for (const link of elements(nav, (node) =>
          hasClass(node, 'post-nav__link')
        )) {
          assert.match(textOf(link).replace(/\s+/g, ''), /^(←上一篇|下一篇→)$/)
        }
      }
    }
  }
})

test('deployment preserves the manuscript route', async () => {
  const { redirects = [] } = JSON.parse(
    await readFile(new URL('../vercel.json', import.meta.url), 'utf8')
  )
  for (const pathname of [sitePath('blogs'), sitePath('blogs/')]) {
    const redirect = redirects.find(({ source }) => source === pathname)
    if (redirect)
      assert.equal(
        new URL(redirect.destination, SITE.website).pathname,
        sitePath('blogs/'),
        'Manuscripts and category bookmarks must not redirect to home'
      )
  }
})

test('section pages select the correct navigation parent before scripts run', () => {
  for (const [page, href] of [
    [blogs, sitePath('blogs/')],
    ...articles.map((page) => [page, sitePath('blogs/')]),
    [interests, sitePath('interests/')],
    [friends, sitePath('friends/')],
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
      MORE_LINKS.map(({ href, external }) => (external ? href : sitePath(href)))
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

test('project groups preserve every configured category and entry', async () => {
  const source = JSON.parse(
    await readFile(
      new URL('../src/content/projects/data.json', import.meta.url),
      'utf8'
    )
  )
  const groups = elements(projects, (node) => hasClass(node, 'project-group'))
  assert.deepEqual(
    groups
      .map((group) =>
        textOf(elements(group, (node) => node.tagName === 'h2')[0])
      )
      .sort(),
    [...new Set(source.map(({ category }) => category))].sort()
  )
  for (const group of groups) {
    const category = textOf(elements(group, (node) => node.tagName === 'h2')[0])
    assert.deepEqual(
      elements(group, (node) => hasClass(node, 'group-card__title'))
        .map(textOf)
        .sort(),
      source
        .filter((entry) => entry.category === category)
        .map(({ id }) => id)
        .sort()
    )
  }
})

test('desktop articles expose an authored TOC directly', () => {
  for (const article of articles) {
    const aside = elements(
      article,
      (node) => node.properties.id === 'desktop-aside'
    )[0]
    if (!aside) continue // Articles may disable TOC or have no eligible headings.
    assert.ok(
      elements(aside, (node) => 'dataTocLink' in node.properties).length > 0,
      'a visible TOC must contain navigable headings'
    )
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
        (node) =>
          node.tagName === 'a' && node.properties.href === sitePath('blogs/')
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
    assert.equal(url.pathname, sitePath('blogs/'))
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

test('recent media appears on home above listening with the interests link', () => {
  const sections = elements(home, (node) => hasClass(node, 'recent-media'))
  assert.equal(sections.length, 1)
  const section = sections[0]
  const title = elements(section, (node) => node.tagName === 'h2')[0]
  assert.equal(textOf(title), '近期书影游')
  assert.deepEqual(section.properties.ariaLabelledBy, [title.properties.id])
  const indexLink = elements(
    section,
    (node) => node.tagName === 'a' && textOf(node) === '全部拾趣'
  )[0]
  assert.ok(indexLink)
  assert.equal(indexLink.properties.href, sitePath('interests/'))
  assert.equal(
    elements(section, (node) => hasClass(node, 'media-cards--auto')).length,
    0,
    'home recent media must not enable auto-scroll'
  )
  const order = elements(
    home,
    (node) =>
      hasClass(node, 'recent-writing') ||
      hasClass(node, 'recent-media') ||
      hasClass(node, 'recent-listening')
  )
  assert.ok(hasClass(order[0], 'recent-writing'))
  assert.equal(order[1], section)
  assert.ok(hasClass(order[2], 'recent-listening'))
  assert.equal(
    elements(interests, (node) => hasClass(node, 'recent-media')).length,
    0
  )
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
  ).filter((file) => /\.(md|mdx)$/.test(file) && file !== 'recent.md')
  assert.equal(
    elements(interests, (node) => node.tagName === 'table-of-contents').length,
    0,
    'the category index has no body headings or directory'
  )
  assert.equal(indexLinks.length, sourceFiles.length)
  for (const link of indexLinks) {
    const pathname = new URL(link.properties.href, SITE.website).pathname
    assert.ok(pathname.startsWith(siteBase.pathname))
    const page = await load(
      `${pathname.slice(siteBase.pathname.length)}index.html`
    )
    const id = decodeURIComponent(pathname.split('/').filter(Boolean).at(-1))
    const menuLink = menuLinks.find(
      (node) => node.properties.href === link.properties.href
    )
    const icons = elements(menuLink, (node) =>
      hasClass(node, 'nav-dropdown__icon')
    )
    const icon = Object.hasOwn(INTEREST_ICONS, id)
      ? INTEREST_ICONS[id]
      : undefined
    assert.equal(
      icons.length,
      icon ? 1 : 0,
      `${id}: unconfigured icons leave no placeholder`
    )
    if (icon) assert.ok(hasClass(icons[0], icon))
    const content = elements(page, (node) => 'dataInterest' in node.properties)
    assert.equal(content.length, 1)
    assert.equal(content[0].properties.dataInterest, id)
    assertBodyToc(page, content[0], id)
    assert.equal(
      elements(page, (node) => hasClass(node, 'recent-media')).length,
      0,
      `${id}: recent media belongs on the home page, not interest categories`
    )
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
          node.properties.href === sitePath('interests/')
      ).length,
      1
    )
  }
})

test('about TOC follows body headings, never the standalone page title', () => {
  assertBodyToc(
    about,
    elements(about, (node) => hasClass(node, 'about-panel'))[0],
    'about'
  )
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

test('home listening ships ten loading skeletons the runtime endpoint fills', async () => {
  const head = elements(home, (node) => node.tagName === 'head')[0]
  const firstModule = elements(
    head,
    (node) => node.tagName === 'script' && node.properties.type === 'module'
  )[0]
  assert.match(
    textOf(firstModule),
    /\/api\/lastfm/,
    'listening starts before unrelated module dependencies finish loading'
  )
  const section = elements(home, (node) =>
    hasClass(node, 'recent-listening')
  )[0]
  assert.ok(section, 'Listening belongs on the home page')
  assert.ok('dataListening' in section.properties)
  assert.equal(section.properties.dataState, 'loading')
  assert.equal(section.properties.ariaBusy, 'true')
  const profile = elements(
    section,
    (node) =>
      typeof node.properties.href === 'string' &&
      node.properties.href.includes('last.fm/user/')
  )[0]
  assert.equal(textOf(profile).trim(), 'Last.fm ↗')
  assert.equal(profile.properties.target, '_blank')
  assert.ok(profile.properties.rel.includes('noopener'))

  // 构建产物里没有听歌数据：统计停在占位，轨道先放十张骨架卡。
  const stats = elements(section, (node) =>
    hasClass(node, 'recent-listening__stats')
  )[0]
  assert.deepEqual(
    elements(stats, (node) => 'dataListeningStat' in node.properties).map(
      (node) => textOf(node).trim()
    ),
    ['—', '—', '—']
  )
  assert.match(textOf(stats), /过去 7 天/)
  assert.match(textOf(stats), /累计/)
  assert.match(textOf(stats), /常听歌手/)
  const rail = elements(section, (node) =>
    hasClass(node, 'media-cards--rail')
  )[0]
  assert.equal(rail.properties.tabIndex, 0)
  assert.equal(rail.properties.role, 'region')
  assert.ok(hasClass(rail, 'media-cards--auto'))
  const track = elements(
    section,
    (node) => 'dataListeningTrack' in node.properties
  )[0]
  assert.ok(track, 'the rail needs its track container before the script runs')
  const skeletons = elements(
    track,
    (node) => 'dataListeningSkeleton' in node.properties
  )
  assert.equal(skeletons.length, 10, 'loading shows ten inert skeleton cards')
  for (const skeleton of skeletons) {
    assert.equal(skeleton.tagName, 'article')
    assert.ok(hasClass(skeleton, 'recent-listening__skeleton'))
    assert.equal(skeleton.properties.ariaHidden, 'true')
    assert.equal(
      elements(skeleton, (node) => node.tagName === 'a').length,
      0,
      'skeletons stay out of the tab order'
    )
    assert.equal(
      elements(skeleton, (node) => node.tagName === 'img').length,
      0,
      'skeletons are not a second image-loading system'
    )
    assert.ok(
      elements(skeleton, (node) =>
        hasClass(node, 'recent-listening__skeleton-cover')
      )[0],
      'cover block'
    )
    assert.equal(
      elements(skeleton, (node) =>
        hasClass(node, 'recent-listening__skeleton-line')
      ).length,
      2,
      'two text-line placeholders'
    )
  }
  assert.equal(
    elements(track, (node) => hasClass(node, 'media-card')).length,
    0,
    'skeletons must not use media-card so marquee ignores them'
  )

  // 卡片模板是脚本填充时唯一的结构来源，页面不再自带第二份标记。
  const template = elements(
    section,
    (node) =>
      node.tagName === 'template' && 'dataListeningCard' in node.properties
  )[0]
  assert.ok(
    template,
    'card markup stays in the component for the script to clone'
  )
  const card = elements(template.content, (node) =>
    hasClass(node, 'media-card')
  )[0]
  assert.ok(hasClass(card, 'media-card--square'))
  assert.equal(card.properties.role, 'listitem')
  const cover = elements(card, (node) => hasClass(node, 'media-card__cover'))[0]
  assert.equal(cover.properties.width, 300)
  assert.equal(cover.properties.height, 300)
  assert.equal(cover.properties.loading, 'lazy')
  assert.equal(cover.properties.src, undefined)
  const source = elements(card, (node) => node.tagName === 'template')[0]
  assert.ok(source, 'author artwork stays inert until the viewer opens')
  assert.ok(elements(source.content, (node) => node.tagName === 'img')[0])
  const title = elements(card, (node) => hasClass(node, 'media-card__title'))[0]
  assert.equal(title.tagName, 'a')
  assert.equal(title.properties.href, undefined)
  assert.equal(title.properties.target, '_blank')
  assert.ok(title.properties.rel.includes('noopener'))
  const meta = elements(card, (node) => hasClass(node, 'media-card__meta'))[0]
  assert.equal(meta.properties.tabIndex, 0)

  // 无脚本时给出去处，而不是停在占位。
  const noscript = elements(section, (node) => node.tagName === 'noscript')[0]
  assert.ok(noscript, 'the section explains itself without scripting')
  assert.match(textOf(noscript), /JavaScript/)
})
