import assert from 'node:assert/strict'
import { access, readFile, readdir, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { fromHtml } from 'hast-util-from-html'
import { parse as parseCss, ident as cssIdentifier } from 'css-tree'
import { toHtml } from 'hast-util-to-html'
import { toRssHtml } from '../src/utils/rss-content.js'
import { visit } from 'unist-util-visit'
import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import remarkDirective from 'remark-directive'
import remarkMediaCard from '../plugins/remark-media-card.ts'
import { SITE } from '../src/config.ts'
import {
  classifyMediaUrl,
  decodeServedPath,
  MEDIA_SRC_ELEMENTS,
} from '../plugins/media-paths.ts'

const siteBase = new URL(
  SITE.base.endsWith('/') ? SITE.base : `${SITE.base}/`,
  SITE.website
)
const built = (path) => new URL(`../dist/${path}`, import.meta.url)
const html = (path) => readFile(built(path), 'utf8')
const DIST_DIR = resolve(fileURLToPath(built('')))

/**
 * URL 路径名 → 产物里的绝对路径。产物不含 base（`public/` 与页面都直接写在
 * `dist/` 根下），所以先剥掉站点 base，再用 `decodeServedPath`（静态层的解码语义）
 * 还原成它真正会去找的文件名 —— 守卫必须和服务器同结论，否则会放行站上 404 的引用。
 * 返回文件系统路径而不是 URL：解码后的 `#`／`?` 若再进 URL 解析会被当成分隔符，
 * 检查的就不是同一个文件了。
 */
const distFile = (pathname) => {
  const base = siteBase.pathname
  const stripped =
    base !== '/' && pathname.startsWith(base)
      ? pathname.slice(base.length - 1)
      : pathname
  const full = resolve(DIST_DIR, decodeServedPath(stripped).replace(/^\/+/, ''))
  assert.ok(
    full === DIST_DIR || full.startsWith(DIST_DIR + sep),
    `URL escapes dist: ${pathname}`
  )
  return full
}

/** URL 指向的文件；文档目标也接受 Astro 的目录 index.html 路由。 */
const artifactFile = async (pathname, allowIndex = false) => {
  const direct = distFile(pathname)
  const candidates = allowIndex
    ? [direct, resolve(direct, 'index.html')]
    : [direct]
  for (const target of candidates) {
    try {
      if ((await stat(target)).isFile()) return target
    } catch {
      // 当前候选不存在，继续检查目录路由。
    }
  }
  return null
}
/** 站内图片 URL → 产物里的文件路径。换算只有一处：distFile（含逃逸与解码）。 */
const localImage = (url) => distFile(url.pathname)

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

/** 正文容器：只看 class，不看标签名 —— 关于页用的是 section，不是 article/div */
const bodiesOf = (tree) => {
  const bodies = []
  visit(tree, 'element', (node) => {
    if (node.properties.className?.includes('markdown-content'))
      bodies.push(node)
  })
  return bodies
}

/**
 * 能作为 `#fragment` 落点的集合：所有元素的 `id`，加上传统 `<a name>`。
 * `<input name>`／`<form name>` 不是锚点，收进来会让失效链接伪装成有效。
 */
const fragmentTargets = (tree) => {
  const ids = new Set()
  visit(tree, 'element', (node) => {
    const id = node.properties.id
    if (typeof id === 'string' && id) ids.add(id)
    if (node.tagName === 'a') {
      const name = node.properties.name
      if (typeof name === 'string' && name) ids.add(name)
    }
  })
  return ids
}

/**
 * Inline style 是声明列表；单条无效声明不影响其他声明，嵌套规则不算属性。
 * 使用 CSS 解析器自带的错误恢复和标识符解码，不自行拼接注释或转义。
 */
const declaredProperties = (style) =>
  parseCss(style, { context: 'declarationList' })
    .children.toArray()
    .filter((node) => node.type === 'Declaration')
    .map((node) => cssIdentifier.decode(node.property).toLowerCase())

/** 文本片段指令不属于元素 id；空片段和隐式 top 均定位页面顶部。 */
const fragmentTarget = (hash) => {
  const raw = hash.replace(/^#/, '').split(':~:')[0]
  let target = raw
  try {
    target = decodeURIComponent(raw)
  } catch {
    // 非法百分号编码保留原值，与同名 id 比较。
  }
  return target === '' || target.toLowerCase() === 'top' ? null : target
}

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
        // 与其它站内地址同一处换算：distFile 已剥 base 并按静态层语义解码
        assets.add(distFile(url.pathname))
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
    const imageReferences = (tree) =>
      elements(tree, 'img').map((image) => ({
        src: image.properties.src,
        alt: image.properties.alt ?? '',
      }))
    assert.deepEqual(
      imageReferences(body),
      imageReferences(expected),
      `${canonical}: RSS must retain every authored image in order`
    )
    assert.equal(
      elements(body, 'table').length,
      elements(expected, 'table').length,
      `${canonical}: RSS preserves tables within its content boundary`
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
  for (const asset of assets) await access(asset)
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
        meta: elements(card, 'p')
          .filter((node) =>
            node.properties.className?.includes('media-card__meta')
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
      `${file}: card titles, metadata and optional ratings match the shared renderer`
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
  const files = (await readdir(built(''), { recursive: true })).filter((file) =>
    file.endsWith('.html')
  )
  for (const file of files) {
    const page = fromHtml(await html(file))
    const bodies = bodiesOf(page)
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
  // 扫全站：关于页、拾趣、首页的正文容器和文章用的是同一套契约，
  // 只枚举 dist/blogs/ 会让它们完全绕过标题 id、锚点、链接、表格与 zoom 检查。
  const files = (await readdir(built(''), { recursive: true })).filter((file) =>
    file.endsWith('.html')
  )
  assert.ok(files.length > 0, 'the built site must contain pages')

  /** 站内链接使用同一处产物解析；文档地址接受目录 index.html。 */
  const resolvePage = (url) => artifactFile(url.pathname, true)

  /** 页面里的锚点落点，按需读取并缓存，用于跨页锚点校验 */
  const idCache = new Map()
  const idsOf = async (file) => {
    if (idCache.has(file)) return idCache.get(file)
    // 非 HTML 目标（媒体、PDF…）没有 DOM 锚点可言，由调用方按目标类型跳过
    const ids = file.endsWith('.html')
      ? fragmentTargets(fromHtml(await readFile(file, 'utf8')))
      : new Set()
    idCache.set(file, ids)
    return ids
  }

  let anchors = 0
  let links = 0
  for (const file of files) {
    const page = fromHtml(await html(file))
    // 相对链接按页面 URL 解析，和浏览器一致；页面地址跟随站点 base
    const pageUrl = new URL(file.replace(/(^|\/)index\.html$/, '$1'), siteBase)
    const ids = fragmentTargets(page)

    // 手写空锚点 <a id="…"></a> 靠这条守着：算法笔记里 `](#15)` 这类跳转
    // 的唯一目标就是它们。清理这些「看起来没用」的锚点会静默打断跳转。
    const targets = new Set()
    visit(page, 'element', (node) => {
      const href = node.properties.href
      // `href="#"` 是合法的“回到顶部”，没有 id 要对
      if (typeof href === 'string' && href.startsWith('#')) {
        const target = fragmentTarget(href)
        if (target !== null) targets.add(target)
      }
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
        // 同页片段由上面的 targets 检查，这里只管跨页
        if (href.startsWith('#')) continue

        // 判同源只能看解析后的 origin，不能看字符串里有沒有协议：`//本站/x` 和
        // `https://本站/x` 都是站内地址，按原实现会被当外站而绕过全部检查。
        let target
        try {
          target = new URL(href, pageUrl)
        } catch {
          assert.fail(`${file}: 链接不是合法地址：${href}`)
        }
        if (target.origin !== siteBase.origin) continue // 异源不抓取、不要求产物
        links++

        // 站内地址必须落在部署 base 内：相对链接向上跳出 base 一样是 404
        assert.ok(
          target.pathname.startsWith(siteBase.pathname),
          `${file}: 站内链接必须落在部署 base 内：${href}`
        )

        const resolved = await resolvePage(target)
        assert.ok(resolved, `${file}: same-site link has no target: ${href}`)

        // 跨页锚点只有 HTML 页面才有落点：`demo.mp4#t=10` 是媒体时间片段，
        // 视频旁推荐的降级链接就是这种写法，不能当 HTML id 对待。
        const fragment = fragmentTarget(target.hash)
        if (fragment === null || !resolved.endsWith('.html')) continue
        assert.ok(
          (await idsOf(resolved)).has(fragment),
          `${file}: link target ${href} has no id #${fragment}`
        )
      }

      // Typora / LeetCode 粘贴残留的 zoom 尺寸标记。zoom 是相对原图的百分比，
      // 已经先被 max-width:100% 限过一次，窄屏上会再缩一半，尺寸不可预测；
      // 尺寸应该写进 alt 的 |w 标记。
      visit(body, 'element', (node) => {
        const style = node.properties.style
        assert.ok(
          !declaredProperties(typeof style === 'string' ? style : '').includes(
            'zoom'
          ),
          `${file}: <${node.tagName}> 不要用 style="zoom:…" 控制尺寸，改用 alt 里的 |w 标记`
        )
      })
    }

    // 写在正文里的 <table> 必须和 Markdown 表格一样拿到横向滚动容器。
    // 这条同时锁住 rehype-raw 的位置：它一旦排到 rehypeWrapAll 之后就会失败。
    for (const body of bodiesOf(page)) {
      visit(body, 'element', (node, _index, parent) => {
        if (node.tagName !== 'table') return
        assert.equal(
          parent?.type === 'element' ? parent.tagName : undefined,
          'div',
          `${file}: every authored table needs the scrolling wrapper`
        )
      })
    }
  }

  console.log(
    `markdown contract: ${files.length} pages, ${anchors} anchors, ${links} same-site links resolved`
  )
})

test('every media reference in the built site is servable', async () => {
  // 扫全站而不是只扫博客：`.mdx` 页面的手写标签不会经过 rehype 阶段，
  // 是媒体层管不到的地方，只有产物能统一拦住。
  const pages = (await readdir(built(''), { recursive: true })).filter((file) =>
    file.endsWith('.html')
  )
  assert.ok(pages.length > 0, 'the built site must contain pages')

  // 标签集合从规则模块取，避免这里漏掉某个标签（例如 track）。
  // `iframe`／`embed`／`object` 不在媒体插件的管理范围内（它只管视频/音频），
  // 但同样只能在站上取到绝对地址，所以一并扫。
  const srcTags = ['img', 'iframe', 'embed', ...MEDIA_SRC_ELEMENTS]
  // `poster` 与 `data` 不是 `src` 属性，单独列出来
  const otherAttributes = [
    ['video', 'poster'],
    ['object', 'data'],
  ]
  let checked = 0

  /**
   * 一个地址要么是能打开的外链，要么是产物里真实存在的站内文件。
   * 判同源看解析后的 origin：完整 http(s) 地址写成本站域名、或写成协议相对的
   * `//本站/…`，都是站内地址，必须和 `/…` 一样有产物。
   */
  const inspect = async (page, pageUrl, tag, value, attribute) => {
    if (typeof value !== 'string' || !value) return
    checked++

    const classified = classifyMediaUrl(value)
    assert.ok(
      ['external', 'rooted'].includes(classified.kind),
      `${page}: <${tag}> ${attribute} 不是可服务的绝对地址（${classified.kind}）：${value}`
    )

    let url
    try {
      url = new URL(value, pageUrl)
    } catch {
      assert.fail(`${page}: <${tag}> ${attribute} 不是合法地址：${value}`)
    }

    if (url.origin !== siteBase.origin) return

    assert.ok(
      url.pathname.startsWith(siteBase.pathname),
      `${page}: <${tag}> ${attribute} 必须落在部署 base 内：${value}`
    )
    assert.ok(
      await artifactFile(
        url.pathname,
        ['iframe', 'embed', 'object'].includes(tag)
      ),
      `${page}: <${tag}> ${attribute} has no artifact: ${value}`
    )
  }

  for (const page of pages) {
    const tree = fromHtml(await html(page))
    const pageUrl = new URL(page.replace(/(^|\/)index\.html$/, '$1'), siteBase)
    for (const tag of srcTags) {
      for (const node of elements(tree, tag)) {
        if (tag === 'img')
          assert.equal(
            node.properties.__astro_image_,
            undefined,
            `${page}: image still has an unresolved Astro placeholder`
          )
        await inspect(page, pageUrl, tag, node.properties.src, 'src')
      }
    }
    for (const [tag, attribute] of otherAttributes) {
      for (const node of elements(tree, tag))
        await inspect(page, pageUrl, tag, node.properties[attribute], attribute)
    }
  }

  console.log(`media contract: ${checked} media references resolved`)
})

test('the custom-style demo preserves fenced code metadata through raw HTML parsing', async () => {
  const page = fromHtml(await html('blogs/image-layout-demo/index.html'))
  const frames = elements(page, 'figure').filter((node) =>
    node.properties.className?.includes('frame')
  )
  const example = frames.find((frame) =>
    elements(frame, 'figcaption').some((caption) =>
      textOf(caption).includes('example.js')
    )
  )
  assert.ok(example, 'the authored filename must reach Expressive Code')
  assert.ok(
    elements(example, 'summary').length,
    'the authored collapse range must remain an expandable section'
  )
  assert.ok(
    elements(example, 'div').some((node) =>
      node.properties.className?.includes('gutter')
    ),
    'the authored line-number option must remain visible'
  )
})
