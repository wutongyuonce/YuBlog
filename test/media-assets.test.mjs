import assert from 'node:assert/strict'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { pathToFileURL } from 'node:url'

import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { fromHtml } from 'hast-util-from-html'
import { visit } from 'unist-util-visit'
import rehypeRaw from 'rehype-raw'

import {
  classifyMediaRef,
  mediaTargetFor,
  mediaUrlFor,
  MEDIA_ROOTS,
  MEDIA_URL_PREFIX,
} from '../plugins/media-paths.ts'
import { syncMedia } from '../plugins/astro-media-sync.ts'
import rehypeMediaAssets from '../plugins/rehype-media-assets.ts'

/**
 * 媒体层的契约：
 *
 * 1. 路径规则只有一处（media-paths），镜像目标、URL、分类都由它推导。
 * 2. 相对路径的视频/音频与指向它们的链接会被改写成 `/_media/…`，并保留 `#t=…`
 *    这类片段；改写后的地址必须真的取得到文件。
 * 3. 无法服务的引用明确失败并报出文件与行号 —— 静默 404 最难排查。
 * 4. Markdown 图片语法产出的图片不归这一层管，仍由 Astro 图片管线接管。
 *
 * 两个用例各自用临时目录当「源根 + 镜像根」，不往仓库里写任何测试文件。
 */

/** 渲染用例的临时根 */
const HOMES = []

const makeRoots = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'yublog-media-'))
  const roots = {
    sourceRoot: path.join(root, 'src'),
    publicDir: path.join(root, 'public', '_media'),
  }
  HOMES.push(root)
  return roots
}

const RENDER_ROOTS = makeRoots()
const ARTICLE = path.join(
  RENDER_ROOTS.sourceRoot,
  'content',
  'blogs',
  'article.md'
)
mkdirSync(path.dirname(ARTICLE), { recursive: true })

after(() => {
  for (const home of HOMES) rmSync(home, { recursive: true, force: true })
})

/** 在渲染用例的源根下造一个临时素材 */
const scratch = (name, content = 'fixture') => {
  const file = path.join(path.dirname(ARTICLE), name)
  writeFileSync(file, content)
  return file
}

/** 只装媒体插件所需的最小管线：先解析原生 HTML，再交给被测插件 */
const render = (markdown) => {
  const processing = createMarkdownProcessor({
    remarkPlugins: [],
    rehypePlugins: [rehypeRaw, [rehypeMediaAssets, { roots: RENDER_ROOTS }]],
    syntaxHighlight: false,
  }).then((processor) =>
    processor.render(markdown, { fileURL: pathToFileURL(ARTICLE) })
  )
  return processing
}

const renderHtml = async (markdown) => (await render(markdown)).code

test('classifyMediaRef 把引用分成互不重叠的六类', () => {
  const classify = (src) => classifyMediaRef(src, ARTICLE, RENDER_ROOTS)

  assert.deepEqual(classify('https://cdn.example.com/a.mp4'), {
    kind: 'external',
  })
  // 协议大小写不该改变分类
  assert.deepEqual(classify('HTTPS://CDN.EXAMPLE.COM/A.MP4'), {
    kind: 'external',
  })
  assert.deepEqual(classify('//cdn.example.com/a.mp4'), { kind: 'external' })
  assert.deepEqual(classify('/videos/a.mp4'), { kind: 'rooted' })
  assert.deepEqual(classify('data:video/mp4;base64,AAAA'), { kind: 'inline' })
  // DATA: 若被当成外链，会一路走到 RSS 才炸
  assert.deepEqual(classify('DATA:image/png;base64,AAAA'), { kind: 'inline' })
  assert.deepEqual(classify('file:///tmp/a.mp4'), {
    kind: 'unsupported',
    scheme: 'file',
  })
  assert.deepEqual(classify('blob:https://x/y'), {
    kind: 'unsupported',
    scheme: 'blob',
  })

  const local = classify('./demo.mp4')
  assert.equal(local.kind, 'local')
  assert.equal(local.file, path.join(path.dirname(ARTICLE), 'demo.mp4'))
  assert.equal(local.url, `${MEDIA_URL_PREFIX}content/blogs/demo.mp4`)

  // 逃出源根的相对路径镜像不到，必须与「可镜像」区分开
  assert.equal(classify('../../../../outside.mp4').kind, 'outside')
})

test('query 与 fragment 不算文件名，源里的百分号编码按浏览器方式解码', () => {
  const classify = (src) => classifyMediaRef(src, ARTICLE, RENDER_ROOTS)
  const dir = path.dirname(ARTICLE)

  // `#t=10` 是合法的媒体片段，不该被当作文件名的一部分
  const fragment = classify('./demo.mp4#t=10')
  assert.equal(fragment.kind, 'local')
  assert.equal(fragment.file, path.join(dir, 'demo.mp4'))

  const query = classify('./demo.mp4?raw=1')
  assert.equal(query.kind, 'local')
  assert.equal(query.file, path.join(dir, 'demo.mp4'))

  const encoded = classify('./a%20b.mp4')
  assert.equal(encoded.kind, 'local')
  assert.equal(encoded.file, path.join(dir, 'a b.mp4'))

  // 文件名里真有百分号时只能写双写转义，反过来也必须一致：
  // 源写 `%2520` → 文件是 `%20` → 输出的 URL 也必须是 `%2520`，
  // 否则浏览器会把 `%20` 解成空格，去请求一个不存在的名字。
  const literal = classify('./a%2520b.mp4')
  assert.equal(literal.kind, 'local')
  assert.equal(literal.file, path.join(dir, 'a%20b.mp4'))
  assert.equal(literal.url, `${MEDIA_URL_PREFIX}content/blogs/a%2520b.mp4`)
})

test('mediaUrlFor / mediaTargetFor 只认源根以内的文件，且能注入别的根', () => {
  const inside = path.join(MEDIA_ROOTS.sourceRoot, 'content', 'demo.mp4')
  assert.equal(mediaUrlFor(inside), `${MEDIA_URL_PREFIX}content/demo.mp4`)
  assert.equal(
    mediaTargetFor(inside),
    path.join(MEDIA_ROOTS.publicDir, 'content', 'demo.mp4')
  )

  assert.equal(mediaUrlFor('/tmp/elsewhere.mp4'), null)
  assert.equal(mediaTargetFor('/tmp/elsewhere.mp4'), null)

  const roots = {
    sourceRoot: '/tmp/src-fixture/',
    publicDir: '/tmp/pub-fixture/',
  }
  assert.equal(
    mediaUrlFor('/tmp/src-fixture/a.mp4', roots),
    `${MEDIA_URL_PREFIX}a.mp4`
  )
  assert.equal(
    mediaTargetFor('/tmp/src-fixture/a.mp4', roots),
    path.join('/tmp/pub-fixture/', 'a.mp4')
  )
  assert.equal(mediaUrlFor('/tmp/elsewhere/a.mp4', roots), null)

  // 逐段编码：空格和 `%` 在 URL 里都有确定含义，不能原样写进去
  const sourceRoot = MEDIA_ROOTS.sourceRoot
  assert.equal(
    mediaUrlFor(path.join(sourceRoot, 'content', 'a b.mp4')),
    `${MEDIA_URL_PREFIX}content/a%20b.mp4`
  )
  assert.equal(
    mediaUrlFor(path.join(sourceRoot, 'content', 'a%20b.mp4')),
    `${MEDIA_URL_PREFIX}content/a%2520b.mp4`
  )
})

test('相对路径的视频/音频与媒体链接被改写，外链与站内绝对路径原样保留', async () => {
  scratch('demo.mp4')
  scratch('sound.mp3')

  const html = await renderHtml(`
<video src="./demo.mp4" controls></video>
<audio src="./sound.mp3"></audio>
<video controls><source src="./demo.mp4" type="video/mp4"></video>
<video src="https://cdn.example.com/remote.mp4"></video>
<video src="/videos/mine.mp4"></video>
[下载原片](./demo.mp4)
[看另一篇](./another.md)
`)

  const rewritten = `${MEDIA_URL_PREFIX}content/blogs/demo.mp4`
  // video 与 source 两处都要改写
  assert.equal(html.split(rewritten).length - 1, 3)
  assert.match(
    html,
    new RegExp(`<audio src="${MEDIA_URL_PREFIX}content/blogs/sound\\.mp3"`)
  )
  assert.match(html, /src="https:\/\/cdn\.example\.com\/remote\.mp4"/)
  assert.match(html, /src="\/videos\/mine\.mp4"/)
  // 非媒体的相对链接不归这一层管，保持原样（由产物测试与发布预检负责）
  assert.match(html, /href="\.\/another\.md"/)
})

test('媒体片段与查询串在改写后原样保留', async () => {
  scratch('demo.mp4')

  const html = await renderHtml('<video src="./demo.mp4#t=10"></video>')
  assert.match(
    html,
    new RegExp(`src="${MEDIA_URL_PREFIX}content/blogs/demo\\.mp4#t=10"`)
  )

  const query = await renderHtml('[原片](./demo.mp4?raw=1)')
  assert.match(
    query,
    new RegExp(`href="${MEDIA_URL_PREFIX}content/blogs/demo\\.mp4\\?raw=1"`)
  )
})

test('URL 路径里可以原样出现的字符不转义，站上才找得到文件', async () => {
  for (const name of [
    'a&b.mp4',
    'a+b.mp4',
    'a,b.mp4',
    'a:b.mp4',
    'a b.mp4',
    '中文.mp4',
  ])
    scratch(name)

  // `&`、`+`、`,`、`:` 属于路径里可以原样出现的字符；写成 `%26` 之类静态层不会还原，
  // 站上会 404。空格与中文必须转义，静态层会解回来。
  const code = await renderHtml(
    [
      '<video src="./a&amp;b.mp4"></video>',
      '<video src="./a+b.mp4"></video>',
      '<video src="./a,b.mp4"></video>',
      '<video src="./a:b.mp4"></video>',
      '<video src="./a b.mp4"></video>',
      '<video src="./中文.mp4"></video>',
    ].join('\n')
  )

  const srcs = []
  visit(fromHtml(code, { fragment: true }), 'element', (node) => {
    if (node.tagName === 'video') srcs.push(node.properties.src)
  })
  assert.deepEqual(srcs, [
    `${MEDIA_URL_PREFIX}content/blogs/a&b.mp4`,
    `${MEDIA_URL_PREFIX}content/blogs/a+b.mp4`,
    `${MEDIA_URL_PREFIX}content/blogs/a,b.mp4`,
    `${MEDIA_URL_PREFIX}content/blogs/a:b.mp4`,
    `${MEDIA_URL_PREFIX}content/blogs/a%20b.mp4`,
    `${MEDIA_URL_PREFIX}content/blogs/%E4%B8%AD%E6%96%87.mp4`,
  ])
})

test('Markdown 图片语法产出的图片不归媒体层管，仍交给 Astro 图片管线', async () => {
  const { code } = await render('![说明](./pic.png)')
  assert.doesNotMatch(code, /_media/)

  // 归属判据（`localImagePaths`）的边界：同一路径也被 Markdown 图片语法引用时，
  // 手写 <img> 一并算图片管线的，按图片处理而不是报错。SPEC §7 把它写成已知行为，
  // 所以这里锁定行为本身，不去断言 Astro 内部那串元数据的形状。
  // 手写 <img> 会被图片管线一起认领（两个 src 都换成管线占位），所以既不报错、
  // 也不进媒体层；这条一旦坏了就会变成构建报错。
  const mixed = await render(
    '![说明](./pic.png)\n\n<img src="./pic.png" alt="手写">'
  )
  assert.doesNotMatch(mixed.code, /_media/)
})

test('无法服务的引用明确失败，并报出文件与行号', async () => {
  const dir = path.dirname(ARTICLE)
  mkdirSync(path.join(dir, 'dir.mp4'), { recursive: true })
  mkdirSync(path.join(dir, 'dir?name'), { recursive: true })
  mkdirSync(path.join(dir, 'dir#name'), { recursive: true })
  writeFileSync(path.join(dir, 'dir?name', 'clip.mp4'), 'fixture')
  writeFileSync(path.join(dir, 'dir#name', 'clip.mp4'), 'fixture')
  scratch('clip.mkv')
  scratch('a#b.mp4')
  scratch('a?b.mp4')
  symlinkSync(scratch('real.mp4'), path.join(dir, 'linked.mp4'))
  // 路径中间有链接：叶子 lstat 会放行，但枚举不会进入这个链接
  mkdirSync(path.join(dir, 'nested'), { recursive: true })
  writeFileSync(path.join(dir, 'nested', 'inner.mp4'), 'fixture')
  symlinkSync(path.join(dir, 'nested'), path.join(dir, 'linked-dir'))

  // 每类报错都要同时给出位置（路径 + 行号）与作者写的那串原文 ——
  // 多处引用时才分得清说的是哪一处
  const cases = [
    [
      'data: 图片',
      '<img src="data:image/png;base64,AAAA">',
      /data: 内联内容/,
      'data:image/png;base64,AAAA',
    ],
    [
      'data: 视频（大写协议）',
      '<video src="DATA:video/mp4;base64,AAAA"></video>',
      /data: 内联内容/,
      'DATA:video/mp4;base64,AAAA',
    ],
    [
      '其它协议',
      '<video src="file:///tmp/a.mp4"></video>',
      /file: 协议/,
      'file:///tmp/a.mp4',
    ],
    [
      '原生 img 相对路径',
      '<img src="./pic.png">',
      /Markdown 语法/,
      './pic.png',
    ],
    [
      '逃出源根的路径',
      '<video src="../../../outside.mp4"></video>',
      /不在 src\/ 目录内/,
      '../../../outside.mp4',
    ],
    [
      'poster 相对路径',
      '<video src="/a.mp4" poster="./cover.jpg"></video>',
      /poster/,
      './cover.jpg',
    ],
    // 目录与符号链接都会产生一个打不开的 URL，按同一个判据拒绝
    [
      '同名目录',
      '<video src="./dir.mp4"></video>',
      /不是一个可镜像的文件/,
      './dir.mp4',
    ],
    [
      '符号链接',
      '<video src="./linked.mp4"></video>',
      /不是一个可镜像的文件/,
      './linked.mp4',
    ],
    [
      '路径中间有符号链接',
      '<video src="./linked-dir/inner.mp4"></video>',
      /不是一个可镜像的文件/,
      './linked-dir/inner.mp4',
    ],
    [
      '文件不存在',
      '<video src="./missing.mp4"></video>',
      /不是一个可镜像的文件/,
      './missing.mp4',
    ],
    // 含 # / ? 的文件名与目录名在 URL 里必须转义，而静态层解码请求路径时不还原
    // 这两个字符，所以站上取不到：渲染期就拦下。src、Markdown 链接、HTML href 三处都拦
    [
      '文件名带井号',
      '<video src="./a%23b.mp4"></video>',
      /在站上取不到/,
      './a%23b.mp4',
    ],
    [
      '文件名带问号',
      '<video src="./a%3Fb.mp4"></video>',
      /在站上取不到/,
      './a%3Fb.mp4',
    ],
    [
      '目录名带问号',
      '<video src="./dir%3Fname/clip.mp4"></video>',
      /在站上取不到/,
      './dir%3Fname/clip.mp4',
    ],
    [
      '目录名带井号',
      '<video src="./dir%23name/clip.mp4"></video>',
      /在站上取不到/,
      './dir%23name/clip.mp4',
    ],
    [
      '媒体链接逃出源根',
      '[下载](../../../outside.mp4)',
      /不在 src\/ 目录内/,
      '../../../outside.mp4',
    ],
    [
      '扩展名不在列表',
      '<video src="./clip.mkv"></video>',
      /不在可镜像的媒体列表里/,
      './clip.mkv',
    ],
  ]

  for (const [name, markdown, expected, raw] of cases) {
    await assert.rejects(
      () => renderHtml(markdown),
      (error) => {
        // Astro 会在外面套一层 `Failed to parse Markdown file "…"`，所以不锚定行首
        assert.match(error.message, /\[media\] /, name)
        assert.match(error.message, expected, name)
        // 能定位才有用：文件路径 + 行号
        assert.match(error.message, /article\.md:\d+/, name)
        // 作者写的那串原文也要出现，否则不知道报的是哪一处引用
        assert.ok(error.message.includes(raw), `${name}: 报错缺少原始值 ${raw}`)
        return true
      },
      name
    )
  }
})

test('镜像幂等、清理陈旧产物，并跳过目录与符号链接', () => {
  const roots = makeRoots()
  const nested = path.join(roots.sourceRoot, 'nested')
  mkdirSync(nested, { recursive: true })
  const source = path.join(nested, 'clip.mp4')
  writeFileSync(source, 'video')
  symlinkSync(source, path.join(roots.sourceRoot, 'linked.mp4'))
  const linkedDir = path.join(roots.sourceRoot, 'linked-dir')
  symlinkSync(nested, linkedDir)

  const target = mediaTargetFor(source, roots)
  assert.ok(target, '源根下的素材必须能算出镜像目标')

  syncMedia(roots)
  assert.equal(existsSync(target), true, '首次同步必须把文件复制过去')
  assert.equal(
    existsSync(path.join(roots.publicDir, 'linked.mp4')),
    false,
    '符号链接不镜像：渲染期校验也会拒绝它，两侧判据一致'
  )

  // 内容和 mtime 都没变时不应重复复制
  const stamp = statSync(target).mtimeMs
  assert.equal(syncMedia(roots).copied, 0, '内容未变时不应重复复制')
  assert.equal(statSync(target).mtimeMs, stamp)

  // 大小相同但内容变了（导入了一个时间戳更早的新文件）也必须重写：
  // 只比大小、或把新时间戳当“更新”，都会永久留着旧内容
  writeFileSync(source, 'VIDEO')
  const older = new Date(Date.now() - 86_400_000)
  utimesSync(source, older, older)
  assert.equal(syncMedia(roots).copied, 1, '内容变了就必须重写')
  assert.equal(statSync(target).size, 5)

  // 源文件删除后，陈旧产物必须被清理，否则会一直躺在产物里
  rmSync(source)
  syncMedia(roots)
  assert.equal(existsSync(target), false, '源文件删除后应清理陈旧产物')
})

test('路径段边界两侧一致：..clip.mp4 既渲染放行也能镜像，源删除后产物消失', () => {
  const roots = makeRoots()
  const dir = path.join(roots.sourceRoot, 'content', 'blogs')
  mkdirSync(dir, { recursive: true })
  const source = path.join(dir, '..clip.mp4')
  writeFileSync(source, 'video')

  // 同一个文件相对源根是 content/blogs/..clip.mp4，相对所在目录是 ..clip.mp4。
  // 判据必须两边同结论：曾经渲染放行、枚举拒绝，于是有 URL 没有产物，还漏清陈旧文件。
  const ref = classifyMediaRef('./..clip.mp4', path.join(dir, 'a.md'), roots)
  assert.equal(ref.kind, 'local')
  assert.equal(ref.file, source)
  assert.equal(
    mediaUrlFor(source, roots),
    `${MEDIA_URL_PREFIX}content/blogs/..clip.mp4`
  )

  const target = mediaTargetFor(source, roots)
  syncMedia(roots)
  assert.equal(existsSync(target), true, '渲染放行的文件必须真的被镜像')

  // 真正的越界仍要拒绝
  assert.equal(
    classifyMediaRef('../../../outside.mp4', path.join(dir, 'a.md'), roots)
      .kind,
    'outside'
  )

  rmSync(source)
  syncMedia(roots)
  assert.equal(existsSync(target), false, '源删除后产物必须消失')
})

test('镜像不会经目标端符号链接改写镜像根之外的文件', () => {
  const roots = makeRoots()
  const home = path.dirname(path.dirname(roots.publicDir))
  const outside = path.join(home, 'outside.txt')
  const outsideDir = path.join(home, 'outside-dir')
  mkdirSync(outsideDir, { recursive: true })
  writeFileSync(outside, 'DO NOT OVERWRITE')
  writeFileSync(path.join(outsideDir, 'keep.txt'), 'KEEP')

  const leafSource = path.join(roots.sourceRoot, 'clip.mp4')
  const nestedSource = path.join(roots.sourceRoot, 'content', 'nested.mp4')
  mkdirSync(path.dirname(nestedSource), { recursive: true })
  writeFileSync(leafSource, 'video')
  writeFileSync(nestedSource, 'nested-video')

  // 派生目录里手工塞进的链接：copyFileSync 会跟随它写到外面去
  mkdirSync(roots.publicDir, { recursive: true })
  const leafTarget = path.join(roots.publicDir, 'clip.mp4')
  symlinkSync(outside, leafTarget)
  symlinkSync(outsideDir, path.join(roots.publicDir, 'content'))

  syncMedia(roots)

  assert.equal(readFileSync(outside, 'utf8'), 'DO NOT OVERWRITE')
  assert.equal(readFileSync(path.join(outsideDir, 'keep.txt'), 'utf8'), 'KEEP')
  assert.equal(
    existsSync(path.join(outsideDir, 'nested.mp4')),
    false,
    '不能写进链接指向的外部目录'
  )
  assert.equal(
    lstatSync(leafTarget).isSymbolicLink(),
    false,
    '链接要换成真实文件'
  )
  assert.equal(readFileSync(leafTarget, 'utf8'), 'video')
})

/**
 * 模仿 Astro 交给插件的正文：去掉 frontmatter 块，再裁掉前导空行。
 * 真机实测：源文件第 9 行的 <video>（frontmatter 5 行 + 1 空行）报 :9，
 * 第 10 行的（2 空行）报 :10，所以「正文第 1 行 = frontmatter 之后第一个非空行」。
 */
const astroBody = (text) => {
  const lines = text.split(/\r?\n/)
  let index = lines[0]?.trim() === '---' ? lines.indexOf('---', 1) + 1 : 0
  while (index < lines.length && lines[index].trim() === '') index += 1
  return lines.slice(index).join('\n')
}

test('镜像根自身是链接时不会写到它指向的外部目录', () => {
  const roots = makeRoots()
  const home = path.dirname(path.dirname(roots.publicDir))
  const outsideDir = path.join(home, 'outside-root')
  mkdirSync(outsideDir, { recursive: true })
  writeFileSync(path.join(outsideDir, 'keep.txt'), 'KEEP')

  const source = path.join(roots.sourceRoot, 'clip.mp4')
  mkdirSync(roots.sourceRoot, { recursive: true })
  writeFileSync(source, 'video')

  // public/_media 自己是链接：复制会写进外部目录，清理会删掉那里的文件
  mkdirSync(path.dirname(roots.publicDir), { recursive: true })
  symlinkSync(outsideDir, roots.publicDir)

  syncMedia(roots)

  assert.equal(
    existsSync(path.join(outsideDir, 'keep.txt')),
    true,
    '外部目录里的文件不能被清理掉'
  )
  assert.equal(
    existsSync(path.join(outsideDir, 'clip.mp4')),
    false,
    '不能写进链接指向的外部目录'
  )
  assert.equal(
    lstatSync(roots.publicDir).isSymbolicLink(),
    false,
    '镜像根要换成真实目录'
  )
  assert.equal(
    readFileSync(path.join(roots.publicDir, 'clip.mp4'), 'utf8'),
    'video'
  )
})

test('目标端链接的内容与源一样也必须换成真实文件', () => {
  const roots = makeRoots()
  const home = path.dirname(path.dirname(roots.publicDir))
  const outside = path.join(home, 'outside.txt')
  const source = path.join(roots.sourceRoot, 'clip.mp4')
  mkdirSync(roots.sourceRoot, { recursive: true })
  writeFileSync(source, 'video')
  writeFileSync(outside, 'VIDEO') // 与源同大小，让「是否最新」的判据命中

  mkdirSync(roots.publicDir, { recursive: true })
  const target = path.join(roots.publicDir, 'clip.mp4')
  symlinkSync(outside, target)
  const { atime, mtime } = statSync(source)
  utimesSync(outside, atime, mtime)

  syncMedia(roots)

  assert.equal(lstatSync(target).isSymbolicLink(), false, '链接不能留在产物里')
  assert.equal(readFileSync(target, 'utf8'), 'video')
  assert.equal(readFileSync(outside, 'utf8'), 'VIDEO', '外部文件不能被改写')
})

test('报错按源文件行号定位，并带上作者写的原始值', async () => {
  const source = [
    '---',
    'title: 行号探针',
    'category: 测试',
    'pubDate: 2026-01-01',
    '---',
    '',
    '正文第一段。',
    '',
    '<video src="./missing.mp4?origin=test#t=10"></video>',
  ].join('\n')
  writeFileSync(ARTICLE, source)

  try {
    await assert.rejects(
      () => render(astroBody(source)),
      (error) => {
        // 视频在源文件第 9 行，不是正文第 3 行（第 3 行是 category）
        assert.match(error.message, /article\.md:9 /)
        // 原始值要原样出现，否则作者不知道是哪一处
        assert.match(error.message, /\.\/missing\.mp4\?origin=test#t=10/)
        return true
      }
    )

    // 更长的 frontmatter、多个前导空行与 CRLF 必须得到同一个源文件行号
    const crlf = [
      '---',
      'title: 行号探针',
      'description: 更长的 frontmatter',
      'category: 测试',
      'order: 7',
      'pubDate: 2026-01-01',
      '---',
      '',
      '',
      '<video src="./missing.mp4"></video>',
    ].join('\r\n')
    writeFileSync(ARTICLE, crlf)
    await assert.rejects(
      () => render(astroBody(crlf)),
      (error) => {
        assert.match(error.message, /article\.md:10 /)
        return true
      }
    )
  } finally {
    rmSync(ARTICLE, { force: true })
  }
})
