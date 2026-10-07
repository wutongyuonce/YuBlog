import { readFileSync } from 'node:fs'
import path from 'node:path'

import { visit } from 'unist-util-visit'

import {
  classifyMediaRef,
  findUnservableSegment,
  isMirrorableFile,
  MEDIA_EXTENSIONS,
  MEDIA_ROOTS,
  MEDIA_SRC_ELEMENTS,
} from './media-paths.ts'

import type { MediaRoots } from './media-paths.ts'
import type { Element, Root } from 'hast'
import type { VFile } from 'vfile'

/**
 * 正文媒体引用的改写与校验。必须紧跟 `rehype-raw`，这样写在 HTML 里的
 * `<video>` / `<img>` 已经是真元素，`src` 属性才看得见。
 *
 * 每种引用的处理策略（本模块对外的契约）：
 *
 * | 位置 | http(s) / `//` / `/…` | 相对路径 | `data:` / 其它协议 |
 * |---|---|---|---|
 * | `video/audio/source/track` 的 `src` | 原样 | 校验后改写为 `/_media/…` | 报错 |
 * | 指向媒体文件的 `a` 的 `href` | 原样 | 校验后改写为 `/_media/…` | 不动 |
 * | `img` 的 `src`（非 Astro 拥有） | 原样 | 报错，提示改用 Markdown 语法 | 报错 |
 * | `video` 的 `poster` | 原样 | 报错，提示改用站内绝对路径 | 报错 |
 *
 * `img` 相对路径为什么报错而不是改写：图片有 Markdown 语法，走 Astro 图片管线
 * 才能拿到压缩和 srcset；而原生 `<img>` 的相对路径拿不到管线，只能原样服务 ——
 * 那既没有优化，也不该为它单独镜像一份源图。让它明确失败，比静默 404 好。
 *
 * 判断「谁拥有这张图」的依据是 `file.data.astro.localImagePaths` / `remoteImagePaths`。
 * 因此有一个已知边界：同一篇里若该路径也被 Markdown 图片语法引用，手写 `<img>`
 * 会一并被登记、从而按管线处理而不是报错 —— 结果是图片被正常优化，不会 404。
 *
 * `srcset` 不处理：它没有单一 URL 可改写，相对路径会静默 404。写响应式图片请用
 * Markdown 语法或绝对 URL。
 */

/** 这些元素的 `src` 必须是一个可服务的地址，相对路径会被镜像改写 */
const SERVABLE_SRC_TAGS = new Set(MEDIA_SRC_ELEMENTS)

/** Astro 图片管线认领的路径，由 Markdown 图片语法产出 */
interface AstroOwnedImages {
  localImagePaths?: string[]
  remoteImagePaths?: string[]
}

/**
 * 正文行号 → 源文件行号。
 *
 * 集合正文可能已裁掉 frontmatter 与前导空行，直接 Markdown 页面则可能保留
 * 全文位置。只有 vfile 内容确实是源文件后缀时，才加上被裁前缀的换行数；
 * 全文、读不到源文件或内容不匹配时偏移为 0。统一 CRLF，忽略末尾空白。
 */
function sourceLineOffset(file: VFile): number {
  try {
    const source = readFileSync(file.path, 'utf8')
      .replace(/\r\n/g, '\n')
      .trimEnd()
    const body = file.toString().replace(/\r\n/g, '\n').trimEnd()
    if (!body || !source.endsWith(body)) return 0
    return source.slice(0, source.length - body.length).split('\n').length - 1
  } catch {
    return 0
  }
}

/** 位置信息缺失时退化为文件路径。报错必须能让人直接找到那一行。 */
const describe = (file: VFile, node: Element) => {
  const filePath = file.path ?? '(未知文件)'
  const relative = path.isAbsolute(filePath)
    ? path.relative(process.cwd(), filePath)
    : filePath
  const line = node.position?.start.line
  if (!line) return relative
  const offset = path.isAbsolute(filePath) ? sourceLineOffset(file) : 0
  return `${relative}:${line + offset}`
}

const fail = (file: VFile, node: Element, message: string): never => {
  throw new Error(`[media] ${describe(file, node)} ${message}`)
}

/**
 * 报错要带上作者写的那串原文，否则在多处引用时不知道说的是哪一处。
 * `data:` 这类内联内容可能很长，截断以免淹没真正的原因。
 */
const echo = (value: string) =>
  value.length > 80 ? `${value.slice(0, 80)}…` : value

/** `data:` 内联内容一律拒绝：产物里是巨型字符串，RSS 也无法取材 */
const rejectInline = (
  file: VFile,
  node: Element,
  attribute: string,
  value: string
) =>
  fail(
    file,
    node,
    `的 ${attribute} 是 ${echo(value)}（data: 内联内容），本站不提供这种引用。` +
      `请把内容存成独立文件再引用：视频/音频放 md 旁边写相对路径，图片用 Markdown 语法 ![](./name.png)。`
  )

/** 相对路径的媒体：确认路径可取、扩展名可镜像、文件确实存在，然后改写地址 */
const rewriteLocal = (
  file: VFile,
  node: Element,
  attribute: string,
  ref: { file: string; url: string },
  value: string,
  roots: MediaRoots
) => {
  const unservable = findUnservableSegment(ref.file, roots.sourceRoot)
  if (unservable)
    fail(
      file,
      node,
      `的 ${attribute} 是 ${value}，路径里的 \`${unservable.segment}\` 含 ` +
        `${unservable.characters.map((character) => `\`${character}\``).join('、')}：` +
        `这些字符在 URL 里必须转义，而静态层解码请求路径时不还原它们，` +
        `所以这种文件与目录名在站上取不到（构建本身不会报错）。请改名，并用 preview 复核。`
    )

  const extension = path.extname(ref.file).toLowerCase()
  if (!MEDIA_EXTENSIONS.has(extension))
    fail(
      file,
      node,
      `的 ${attribute} 是 ${echo(value)}，扩展名 ${
        extension === '' ? '（没有扩展名）' : extension
      } 不在可镜像的媒体列表里（可镜像：${[...MEDIA_EXTENSIONS].join(' ')}）。` +
        `图片请改用 Markdown 语法 ![](./name.png) 走 Astro 图片管线；字幕等其它类型` +
        `请放进 public/ 并用站内绝对路径引用，例如 <track src="/subs.vtt">。`
    )

  if (!isMirrorableFile(ref.file, roots.sourceRoot))
    fail(
      file,
      node,
      `的 ${attribute} 是 ${value}，指向的不是一个可镜像的文件：${ref.file}` +
        `（文件缺失，或是目录、符号链接，或路径中间有符号链接）。`
    )

  node.properties[attribute] = ref.url
}

/** `video/audio/source/track` 的 src 与 `img` 的 src 策略不同，在这里分派 */
const checkSrc = (
  file: VFile,
  node: Element,
  value: string,
  markdownPath: string,
  owned: Set<string>,
  roots: MediaRoots
) => {
  // 所有权必须与 Astro remarkCollectImages / rehypeImages 的 decodeURI 一致，
  // 保留字符编码不能按媒体文件名的 decodeURIComponent 规则还原。
  if (node.tagName === 'img') {
    try {
      if (owned.has(decodeURI(value))) return
    } catch {
      // 无效转义不可能被 Astro 认领；仍由下面的媒体检查给出文件与行号。
    }
  }

  const ref = classifyMediaRef(value, markdownPath, roots)
  switch (ref.kind) {
    case 'external':
    case 'rooted':
      return
    case 'invalid':
      return fail(
        file,
        node,
        `的 src 是 ${echo(value)}，不是带有效主机名的 http(s):// 或 //host 地址。`
      )
    case 'inline':
      return rejectInline(file, node, 'src', value)
    case 'unsupported':
      return fail(
        file,
        node,
        `的 src 是 ${echo(value)}，用了 ${ref.scheme}: 协议，浏览器在站上打不开，` +
          `外链也不是可用地址。本地文件请放 md 旁边写相对路径，网络资源请用 http(s)。`
      )
    case 'outside':
      return fail(
        file,
        node,
        `的 src 指向 "${value}"，它不在 src/ 目录内，无法镜像到站点。`
      )
    case 'local':
      if (node.tagName === 'img')
        return fail(
          file,
          node,
          `的 src 是本地相对路径。图片请改用 Markdown 语法 ![](${value})，` +
            `这样才能走 Astro 图片管线拿到压缩和 srcset。`
        )
      return rewriteLocal(file, node, 'src', ref, value, roots)
  }
}

/**
 * `<a href="./demo.mp4">` 和 `<video src>` 指向同一份文件，所以用同一套规则：
 * 能本地服务的照 `src` 改写，逃出 `src/` 的照 `src` 报错。
 * 非媒体链接不归这一层（相对 `.md` 之类由发布预检与产物测试负责），
 * `mailto:`／`tel:` 等协议也原样保留。
 */
const checkHref = (
  file: VFile,
  node: Element,
  markdownPath: string,
  roots: MediaRoots
) => {
  const href = node.properties.href
  if (typeof href !== 'string' || !href.trim()) return

  const ref = classifyMediaRef(href, markdownPath, roots)
  if (ref.kind === 'local') {
    if (MEDIA_EXTENSIONS.has(path.extname(ref.file).toLowerCase()))
      rewriteLocal(file, node, 'href', ref, href, roots)
    return
  }

  if (
    ref.kind === 'outside' &&
    MEDIA_EXTENSIONS.has(path.extname(ref.file).toLowerCase())
  )
    fail(
      file,
      node,
      `的 href 是 ${href}，指向的媒体文件不在 src/ 目录内，无法镜像到站点。` +
        `本地媒体要放在 md 旁边或 src/ 的子目录里。`
    )
}

const checkPoster = (
  file: VFile,
  node: Element,
  markdownPath: string,
  roots: MediaRoots
) => {
  const poster = node.properties.poster
  if (typeof poster !== 'string' || !poster.trim()) return

  const ref = classifyMediaRef(poster, markdownPath, roots)
  if (ref.kind === 'external' || ref.kind === 'rooted') return
  if (ref.kind === 'invalid')
    return fail(
      file,
      node,
      `的 poster 是 ${echo(poster)}，不是带有效主机名的 http(s):// 或 //host 地址。`
    )
  if (ref.kind === 'inline') return rejectInline(file, node, 'poster', poster)
  if (ref.kind === 'unsupported')
    return fail(
      file,
      node,
      `的 poster 是 ${echo(poster)}，用了 ${ref.scheme}: 协议，` +
        `图片请用 http(s) 或站内绝对路径。`
    )

  fail(
    file,
    node,
    `的 poster 是本地相对路径 "${poster}"。poster 是图片，镜像层只处理视频/音频，` +
      `请把图片放进 public/ 并用站内绝对路径引用（例如 /media/poster.jpg）。`
  )
}

function rehypeMediaAssets(options: { roots?: MediaRoots } = {}) {
  const roots = options.roots ?? MEDIA_ROOTS

  return (tree: Root, file: VFile) => {
    const markdownPath = file.path
    if (!markdownPath) return

    const astro = (file.data as { astro?: AstroOwnedImages }).astro
    const owned = new Set([
      ...(astro?.localImagePaths ?? []),
      ...(astro?.remoteImagePaths ?? []),
    ])

    visit(tree, 'element', (node: Element) => {
      const src = node.properties.src
      const hasSrc =
        typeof src === 'string' &&
        src.trim() !== '' &&
        (node.tagName === 'img' || SERVABLE_SRC_TAGS.has(node.tagName))
      if (hasSrc) checkSrc(file, node, src, markdownPath, owned, roots)

      if (node.tagName === 'a') checkHref(file, node, markdownPath, roots)
      if (node.tagName === 'video') checkPoster(file, node, markdownPath, roots)
    })
  }
}

export default rehypeMediaAssets
