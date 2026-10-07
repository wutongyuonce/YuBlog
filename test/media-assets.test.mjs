import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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
  scratch('clip.mkv')
  scratch('a#b.mp4')
  scratch('a?b.mp4')
  symlinkSync(scratch('real.mp4'), path.join(dir, 'linked.mp4'))
  // 路径中间有链接：叶子 lstat 会放行，但枚举不会进入这个链接
  mkdirSync(path.join(dir, 'nested'), { recursive: true })
  writeFileSync(path.join(dir, 'nested', 'inner.mp4'), 'fixture')
  symlinkSync(path.join(dir, 'nested'), path.join(dir, 'linked-dir'))

  const cases = [
    ['data: 图片', '<img src="data:image/png;base64,AAAA">', /data: 内联内容/],
    [
      'data: 视频（大写协议）',
      '<video src="DATA:video/mp4;base64,AAAA"></video>',
      /data: 内联内容/,
    ],
    ['其它协议', '<video src="file:///tmp/a.mp4"></video>', /file: 协议/],
    ['原生 img 相对路径', '<img src="./pic.png">', /Markdown 语法/],
    [
      '逃出源根的路径',
      '<video src="../../../outside.mp4"></video>',
      /不在 src\/ 目录内/,
    ],
    [
      'poster 相对路径',
      '<video src="/a.mp4" poster="./cover.jpg"></video>',
      /poster/,
    ],
    // 目录与符号链接都会产生一个打不开的 URL，按同一个判据拒绝
    ['同名目录', '<video src="./dir.mp4"></video>', /不是一个可镜像的文件/],
    ['符号链接', '<video src="./linked.mp4"></video>', /不是一个可镜像的文件/],
    [
      '路径中间有符号链接',
      '<video src="./linked-dir/inner.mp4"></video>',
      /不是一个可镜像的文件/,
    ],
    [
      '文件不存在',
      '<video src="./missing.mp4"></video>',
      /不是一个可镜像的文件/,
    ],
    // 文件名带 # 或 ? 时本站取不到（实测 dev 与 preview 都 404），必须构建期拦住
    ['文件名带井号', '<video src="./a%23b.mp4"></video>', /文件名带/],
    ['文件名带问号', '<video src="./a%3Fb.mp4"></video>', /文件名带/],
    [
      '扩展名不在列表',
      '<video src="./clip.mkv"></video>',
      /不在可镜像的媒体列表里/,
    ],
  ]

  for (const [name, markdown, expected] of cases) {
    await assert.rejects(
      () => renderHtml(markdown),
      (error) => {
        // Astro 会在外面套一层 `Failed to parse Markdown file "…"`，所以不锚定行首
        assert.match(error.message, /\[media\] /, name)
        assert.match(error.message, expected, name)
        // 能定位才有用：文件路径 + 行号
        assert.match(error.message, /article\.md:\d+/, name)
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
