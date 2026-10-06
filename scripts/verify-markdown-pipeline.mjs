import assert from 'node:assert/strict'
import { access, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { fromHtml } from 'hast-util-from-html'
import { toHtml } from 'hast-util-to-html'
import { toRssHtml } from '../src/utils/rss-content.js'
import { visit } from 'unist-util-visit'
import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import remarkDirective from 'remark-directive'
import remarkMediaCard from '../plugins/remark-media-card.ts'
import { SITE } from '../src/config.ts'
import { classifyMediaUrl, MEDIA_SRC_ELEMENTS } from '../plugins/media-paths.ts'

const siteBase = new URL(
  SITE.base.endsWith('/') ? SITE.base : `${SITE.base}/`,
  SITE.website
)
const built = (path) => new URL(`../dist/${path}`, import.meta.url)
const html = (path) => readFile(built(path), 'utf8')
const DIST_DIR = resolve(fileURLToPath(built('')))

/**
 * URL 路径名 → 产物里的绝对路径。产物不含 base（`public/` 与页面都直接写在
 * `dist/` 根下），所以先剥掉站点 base，再按浏览器方式逐段解码。
 * 返回文件系统路径而不是 URL：解码后的 `#`／`?` 若再进 URL 解析会被当成分隔符，
 * 检查的就不是同一个文件了。
 */
const distFile = (pathname) => {
  const base = siteBase.pathname
  const stripped =
    base !== '/' && pathname.startsWith(base)
      ? pathname.slice(base.length - 1)
      : pathname
  const decoded = stripped
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
    .join('/')
  const full = resolve(DIST_DIR, decoded.replace(/^\/+/, ''))
  assert.ok(
    full === DIST_DIR || full.startsWith(DIST_DIR + sep),
    `URL escapes dist: ${pathname}`
  )
  return full
}

/** 站内地址必须在产物里真的存在，而且是一个文件 */
const artifactExists = async (pathname) => {
  const target = distFile(pathname.split(/[?#]/)[0])
  try {
    return (await stat(target)).isFile()
  } catch {
    return false
  }
}
const localImage = (url) => {
  assert.equal(url.origin, siteBase.origin)
  assert.ok(url.pathname.startsWith(siteBase.pathname))
  return built(url.pathname.slice(siteBase.pathname.length))
}

test('static routes, feed, sitemap and search index exist', async () => {
  await Promise.all(
    [
      'index.html',
      'tags/index.html',
      'archives/index.html',
      'projects/index.html',
      'about/index.html',
      'rss.xml',
      'sitemap-index.xml',
      'pagefind/pagefind-entry.json',
    ].map((path) => access(built(path)))
  )
})

const elements = (tree, tag) => {
  const found = []
  visit(tree, 'element', (node) => {
    if (node.tagName === tag) found.push(node)
  })
  return found
}
const textOf = (node) =>
  node.type === 'text' ? node.value : (node.children || []).map(textOf).join('')

test('full RSS covers every built article and uses real, standalone content assets', async () => {
  const xml = await html('rss.xml')
  assert.equal(XMLValidator.validate(xml), true)
  const channel = new XMLParser({ ignoreAttributes: false }).parse(xml).rss
    .channel
  const items = [].concat(channel.item || [])
  const byUrl = new Map(items.map((item) => [item.guid['#text'], item]))
  assert.equal(byUrl.size, items.length, 'article identities must be unique')
  const files = (await readdir(built('blogs/'), { recursive: true })).filter(
    (path) => path.endsWith('/index.html')
  )
  assert.equal(
    items.length,
    files.length,
    'feed and published pages must have the same scope'
  )
  const assets = new Set()
  for (const file of files) {
    const page = fromHtml(await html(`blogs/${file}`))
    const canonical = elements(page, 'link').find((n) =>
      n.properties.rel?.includes('canonical')
    ).properties.href
    const item = byUrl.get(canonical)
    assert.ok(item, `missing RSS entry for ${canonical}`)
    assert.ok(Object.hasOwn(item, 'content:encoded'), canonical)
    const body = fromHtml(item['content:encoded'], { fragment: true })
    visit(body, 'element', (node) => {
      assert.ok(
        !['script', 'style', 'button'].includes(node.tagName),
        canonical
      )
      for (const prop of ['srcSet', 'className', 'style', 'loading']) {
        assert.equal(node.properties[prop], undefined, `${canonical}: ${prop}`)
      }
    })
    for (const a of elements(body, 'a')) {
      if (a.properties.href)
        assert.match(a.properties.href, /^(https?:|mailto:|tel:)/)
    }
    for (const img of elements(body, 'img')) {
      const url = new URL(img.properties.src)
      assert.match(url.protocol, /^https?:$/)
      if (url.origin === new URL(canonical).origin) {
        const base = new URL(channel.link).pathname
        assert.ok(
          url.pathname.startsWith(base),
          'same-site image should respect deployment base'
        )
        assets.add(decodeURIComponent(url.pathname.slice(base.length)))
      }
    }
    assert.equal(elements(body, 'a').at(-1).properties.href, canonical)
    // Copy payloads omit shell comments; their remaining lines must stay ordered.
    const originalCode = elements(page, 'button')
      .filter((n) => typeof n.properties.dataCode === 'string')
      .map((n) => n.properties.dataCode.replaceAll('\x7f', '\n'))
    const rssCode = elements(body, 'pre').map(textOf)
    for (const code of originalCode)
      assert.ok(
        rssCode.some((block) => {
          const lines = block.split('\n')
          let cursor = 0
          return code.split('\n').every((line) => {
            const index = lines.indexOf(line, cursor)
            cursor = index + 1
            return index !== -1
          })
        }),
        `code lines lost: ${canonical}: ${code.slice(0, 80)}`
      )

    const article = elements(page, 'article').find((node) =>
      node.properties.className?.includes('post-content')
    )
    assert.ok(article, `${canonical}: the published page has an article body`)
    const content = {
      type: 'root',
      children: article.children.filter(
        (node) =>
          node.type !== 'element' || node.tagName !== 'table-of-contents'
      ),
    }
    // The site compresses inter-element whitespace; compare prose without
    // locking its serialization. Code line order is checked separately above.
    const expected = fromHtml(toRssHtml(toHtml(content), canonical), {
      fragment: true,
    })
    assert.equal(
      textOf(body).replace(/\s+/g, ''),
      textOf(expected).replace(/\s+/g, ''),
      `${canonical}: RSS must retain the complete authored text`
    )
    assert.equal(
      elements(body, 'table').length,
      elements(article, 'table').length,
      `${canonical}: RSS preserves authored tables`
    )
    const annotations = elements(page, 'annotation').filter(
      (n) => n.properties.encoding === 'application/x-tex'
    )
    const rssInlineCode = elements(body, 'code').map(textOf)
    for (const annotation of annotations)
      assert.ok(
        rssInlineCode.includes(textOf(annotation)),
        'formula source must survive'
      )
  }
  for (const asset of assets) await access(built(asset))
  const dates = items.map((item) => Date.parse(item.pubDate))
  assert.deepEqual(
    dates,
    [...dates].sort((a, b) => b - a)
  )
  console.log(
    `RSS: ${items.length} articles, ${assets.size} local image assets, ${Buffer.byteLength(xml)} bytes`
  )
})

test('home and interest cards preserve authored content through the shared pipeline', async () => {
  const home = fromHtml(await html('index.html'))
  const recent = elements(home, 'div').find((node) =>
    node.properties.className?.includes('recent-media__body')
  )
  assert.ok(recent, 'home renders the standalone recent.md content')
  const processor = await createMarkdownProcessor({
    remarkPlugins: [remarkDirective, remarkMediaCard],
  })
  const cardContent = (tree) =>
    elements(tree, 'article')
      .filter((node) => node.properties.className?.includes('media-card'))
      .map((card) => ({
        title: elements(card, 'a')
          .concat(elements(card, 'p'))
          .filter((node) =>
            node.properties.className?.includes('media-card__title')
          )
          .map(textOf),
        rating: elements(card, 'p')
          .filter((node) =>
            node.properties.className?.includes('media-card__score')
          )
          .map(textOf),
      }))
  const files = (
    await readdir(new URL('../src/content/interests/', import.meta.url))
  ).filter((file) => /\.(md|mdx)$/.test(file) && file !== 'intro.md')
  for (const file of files) {
    const source = await readFile(
      new URL(`../src/content/interests/${file}`, import.meta.url),
      'utf8'
    )
    const { code } = await processor.render(source)
    const page =
      file === 'recent.md'
        ? recent
        : fromHtml(
            await html(
              `interests/${file.replace(/\.(md|mdx)$/, '')}/index.html`
            )
          )
    assert.deepEqual(
      cardContent(page),
      cardContent(fromHtml(code)),
      `${file}: card titles and optional ratings match the shared renderer`
    )
    for (const card of elements(page, 'article').filter((node) =>
      node.properties.className?.includes('media-card')
    )) {
      // The shared plugin owns rejection; this checks its rendered cover and resources.
      const covers = elements(card, 'img')
      assert.ok(covers.length <= 1, `${file}: cards have at most one cover`)
      for (const cover of covers) {
        assert.ok(cover.properties.className?.includes('media-card__cover'))
        const url = new URL(cover.properties.src, siteBase)
        if (url.origin !== siteBase.origin) continue // Remote covers are not fetched.
        assert.equal(cover.properties.dataAstroImage, 'constrained')
        await access(localImage(url))
      }
    }
  }
  for (const id of ['intro', 'recent']) {
    await assert.rejects(access(built(`interests/${id}/index.html`)), {
      code: 'ENOENT',
    })
  }
})

test('rendered Markdown headings and processed images remain usable', async () => {
  const files = (await readdir(built(''), { recursive: true })).filter(
    (file) => file === 'index.html' || file.endsWith('/index.html')
  )
  for (const file of files) {
    const page = fromHtml(await html(file))
    const bodies = elements(page, 'article')
      .concat(elements(page, 'div'))
      .filter((node) => node.properties.className?.includes('markdown-content'))
    for (const body of bodies) {
      for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
        for (const heading of elements(body, tag)) {
          assert.ok(
            heading.properties.id,
            `${file}: Markdown heading has an anchor target`
          )
          const anchors = elements(heading, 'a').filter((node) =>
            node.properties.className?.includes('header-anchor')
          )
          assert.equal(anchors.length, 1)
          assert.equal(anchors[0].properties.href, `#${heading.properties.id}`)
        }
      }
      for (const image of elements(body, 'img')) {
        assert.doesNotMatch(image.properties.alt || '', /\|w\d+$/)
        if (!image.properties.dataAstroImage) continue
        assert.ok(image.properties.width > 0 && image.properties.height > 0)
        await access(localImage(new URL(image.properties.src, siteBase)))
      }
    }
  }
})
test('authored HTML is handled like Markdown and every internal anchor resolves', async () => {
  const files = (await readdir(built('blogs/'), { recursive: true })).filter(
    (file) => file.endsWith('/index.html')
  )
  assert.ok(files.length > 0, 'the built site must contain articles')

  const isFile = async (path) => {
    try {
      return (await stat(path)).isFile()
    } catch {
      return false
    }
  }

  // `href="#…"` 的片段是百分号编码的，而 id 不是，比较前必须解码
  const decodeFragment = (value) => {
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }

  /** 站内链接解析成产物里的页面文件；目录必须真的有 index.html */
  const resolvePage = async (url) => {
    if (url.pathname.endsWith('/')) {
      const index = distFile(`${url.pathname}index.html`)
      return (await isFile(index)) ? index : null
    }
    const direct = distFile(url.pathname)
    if (await isFile(direct)) return direct
    const index = distFile(`${url.pathname}/index.html`)
    return (await isFile(index)) ? index : null
  }

  /** 页面里的 id/name 集合，按需读取并缓存，用于跨页锚点校验 */
  const idCache = new Map()
  const idsOf = async (file) => {
    if (idCache.has(file)) return idCache.get(file)
    const ids = new Set()
    if (file.endsWith('.html')) {
      const tree = fromHtml(await readFile(file, 'utf8'))
      visit(tree, 'element', (node) => {
        for (const key of ['id', 'name']) {
          const value = node.properties[key]
          if (typeof value === 'string' && value) ids.add(value)
        }
      })
    }
    idCache.set(file, ids)
    return ids
  }

  /** 正文容器：只看 class，不看标签名 —— 关于页用的是 section */
  const bodiesOf = (tree) => {
    const bodies = []
    visit(tree, 'element', (node) => {
      if (node.properties.className?.includes('markdown-content'))
        bodies.push(node)
    })
    return bodies
  }

  let anchors = 0
  let links = 0
  for (const file of files) {
    const page = fromHtml(await html(`blogs/${file}`))
    // 相对链接按页面 URL 解析，和浏览器一致；页面地址跟随站点 base
    const pageUrl = new URL(`blogs/${dirname(file)}/`, siteBase)

    const ids = new Set()
    visit(page, 'element', (node) => {
      for (const key of ['id', 'name']) {
        const value = node.properties[key]
        if (typeof value === 'string' && value) ids.add(value)
      }
    })

    // 手写空锚点 <a id="…"></a> 靠这条守着：算法笔记里 `](#15)` 这类跳转
    // 的唯一目标就是它们。清理这些「看起来没用」的锚点会静默打断跳转。
    const targets = new Set()
    visit(page, 'element', (node) => {
      const href = node.properties.href
      // `href="#"` 是合法的“回到顶部”，没有 id 要对
      if (typeof href === 'string' && href.startsWith('#') && href.length > 1)
        targets.add(decodeFragment(href.slice(1)))
    })
    for (const target of targets) {
      anchors++
      assert.ok(
        ids.has(target),
        `${file}: internal link #${target} has no target`
      )
    }

    for (const body of bodiesOf(page)) {
      // 正文里的站内链接必须能在产物里找到。`](./xxx.md#anchor)` 这种 Typora
      // 写法会解析成不存在的 .md 文件：页面本身不报错，只有点下去才发现 404。
      for (const node of elements(body, 'a')) {
        const href = node.properties.href
        if (typeof href !== 'string' || !href) continue
        // 外部协议、协议相对、同页片段：分别由别的规则管
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) continue
        if (href.startsWith('#')) continue

        const target = new URL(href, pageUrl)
        links++
        // 站内绝对地址必须带上部署 base，否则子路径部署时点开就是 404
        if (
          href.startsWith('/') &&
          !target.pathname.startsWith(siteBase.pathname)
        )
          assert.fail(
            `${file}: site-absolute link must include the deployment base: ${href}`
          )

        const resolved = await resolvePage(target)
        assert.ok(resolved, `${file}: same-site link has no target: ${href}`)

        // 跨页锚点同样要有落点：删掉目标文章的锚点会让这些链接静默失效
        const fragment = decodeFragment(target.hash.slice(1))
        if (fragment)
          assert.ok(
            (await idsOf(resolved)).has(fragment),
            `${file}: link target ${href} has no id #${fragment}`
          )
      }

      // Typora / LeetCode 粘贴残留的 zoom 尺寸标记。zoom 是相对原图的百分比，
      // 已经先被 max-width:100% 限过一次，窄屏上会再缩一半，尺寸不可预测；
      // 尺寸应该写进 alt 的 |w 标记。属性名不区分大小写。
      visit(body, 'element', (node) => {
        const style = node.properties.style
        assert.doesNotMatch(
          typeof style === 'string' ? style : '',
          /(?:^|;)\s*zoom\s*:/i,
          `${file}: <${node.tagName}> 不要用 style="zoom:…" 控制尺寸，改用 alt 里的 |w 标记`
        )
      })
    }

    // 写在正文里的 <table> 必须和 Markdown 表格一样拿到横向滚动容器。
    // 这条同时锁住 rehype-raw 的位置：它一旦排到 rehypeWrapAll 之后就会失败。
    visit(page, 'element', (node, _index, parent) => {
      if (node.tagName !== 'table') return
      assert.equal(
        parent?.type === 'element' ? parent.tagName : undefined,
        'div',
        `${file}: every table needs the scrolling wrapper`
      )
    })
  }

  console.log(
    `markdown contract: ${files.length} articles, ${anchors} anchors, ${links} same-site links resolved`
  )
})

test('every media reference in the built site is servable', async () => {
  // 扫全站而不是只扫博客：`.mdx` 页面的手写标签不会经过 rehype 阶段，
  // 是媒体层管不到的地方，只有产物能统一拦住。
  const pages = (await readdir(built(''), { recursive: true })).filter((file) =>
    file.endsWith('.html')
  )
  assert.ok(pages.length > 0, 'the built site must contain pages')

  // 标签集合从规则模块取，避免这里漏掉某个标签（例如 track）
  const tags = ['img', ...MEDIA_SRC_ELEMENTS]
  let checked = 0

  /** 一个地址要么是可服务的外链，要么是产物里真实存在的站内文件 */
  const inspect = async (page, tag, value, attribute) => {
    if (typeof value !== 'string' || !value) return
    checked++
    const kind = classifyMediaUrl(value)
    assert.ok(
      kind.kind === 'external' || kind.kind === 'rooted',
      `${page}: <${tag}> ${attribute} must be servable, got ${JSON.stringify(value)} (${kind.kind})`
    )
    if (kind.kind !== 'rooted') return

    assert.ok(
      await artifactExists(value),
      `${page}: <${tag}> ${attribute} has no artifact: ${value}`
    )
  }

  for (const page of pages) {
    const tree = fromHtml(await html(page))
    for (const tag of tags) {
      for (const node of elements(tree, tag)) {
        await inspect(page, tag, node.properties.src, 'src')
        // `<video poster>` 也是站上要打开的图片；`.mdx` 里它同样绕过渲染期检查
        if (tag === 'video')
          await inspect(page, tag, node.properties.poster, 'poster')
      }
    }
  }

  console.log(`media contract: ${checked} media references resolved`)
})
