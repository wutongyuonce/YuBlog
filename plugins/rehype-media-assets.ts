import path from 'node:path'

import { visit } from 'unist-util-visit'

import {
  classifyMediaRef,
  decodeMediaPath,
  hasUnservableName,
  isMirrorableFile,
  mediaSuffix,
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

/** 位置信息缺失时退化为文件路径。报错必须能让人直接找到那一行。 */
const describe = (file: VFile, node: Element) => {
  const filePath = file.path ?? '(未知文件)'
  const relative = path.isAbsolute(filePath)
    ? path.relative(process.cwd(), filePath)
    : filePath
  const line = node.position?.start.line
  return line ? `${relative}:${line}` : relative
}

const fail = (file: VFile, node: Element, message: string): never => {
  throw new Error(`[media] ${describe(file, node)} ${message}`)
}

/** `data:` 内联内容一律拒绝：产物里是巨型字符串，RSS 也无法取材 */
const rejectInline = (file: VFile, node: Element, attribute: string) =>
  fail(
    file,
    node,
    `的 ${attribute} 是 data: 内联内容。请把这段内容存成独立文件再引用：` +
      `视频/音频放 md 旁边写相对路径，图片用 Markdown 语法 ![](./name.png)。`
  )

/** 相对路径的媒体：确认文件名可取、扩展名可镜像、文件确实存在，然后改写地址 */
const rewriteLocal = (
  file: VFile,
  node: Element,
  attribute: string,
  ref: { file: string; url: string },
  suffix: string,
  roots: MediaRoots
) => {
  if (hasUnservableName(ref.file))
    fail(
      file,
      node,
      `的 ${attribute} 指向的文件名带 \`#\` 或 \`?\`，本站的静态服务器取不到这种名字` +
        `（实测 dev 与 preview 都返回 404，而构建不会失败）。请把文件名里的这两个字` +
        `符换成别的字符。`
    )

  const extension = path.extname(ref.file).toLowerCase()
  if (!MEDIA_EXTENSIONS.has(extension))
    fail(
      file,
      node,
      `的 ${attribute} 指向 ${extension === '' ? '没有扩展名的文件' : extension}，` +
        `这个类型不在可镜像的媒体列表里（可镜像：${[...MEDIA_EXTENSIONS].join(' ')}）。` +
        `图片请改用 Markdown 语法 ![](./name.png) 走 Astro 图片管线；字幕等其它类型` +
        `请放进 public/ 并用站内绝对路径引用，例如 <track src="/subs.vtt">。`
    )

  if (!isMirrorableFile(ref.file, roots.sourceRoot))
    fail(
      file,
      node,
      `的 ${attribute} 指向的不是一个可镜像的文件：${ref.file}` +
        `（文件缺失，或是目录、符号链接，或路径中间有符号链接）。`
    )

  node.properties[attribute] = ref.url + suffix
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
  // 由 Markdown 图片语法产出的图片：所有权属于 Astro 图片管线
  if (node.tagName === 'img' && owned.has(decodeMediaPath(value))) return

  const ref = classifyMediaRef(value, markdownPath, roots)
  switch (ref.kind) {
    case 'external':
    case 'rooted':
      return
    case 'inline':
      return rejectInline(file, node, 'src')
    case 'unsupported':
      return fail(
        file,
        node,
        `的 src 用了 ${ref.scheme}: 协议，浏览器在站上打不开，外链也不是可用地址。` +
          `本地文件请放 md 旁边写相对路径，网络资源请用 http(s)。`
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
      return rewriteLocal(file, node, 'src', ref, mediaSuffix(value), roots)
  }
}

/** `<a href="./demo.mp4">` 和 `<video src>` 指向同一份文件，一起改写 */
const checkHref = (
  file: VFile,
  node: Element,
  markdownPath: string,
  roots: MediaRoots
) => {
  const href = node.properties.href
  if (typeof href !== 'string' || !href.trim()) return

  const ref = classifyMediaRef(href, markdownPath, roots)
  if (ref.kind !== 'local') return
  if (!MEDIA_EXTENSIONS.has(path.extname(ref.file).toLowerCase())) return

  rewriteLocal(file, node, 'href', ref, mediaSuffix(href), roots)
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
  if (ref.kind === 'inline') return rejectInline(file, node, 'poster')
  if (ref.kind === 'unsupported')
    return fail(
      file,
      node,
      `的 poster 用了 ${ref.scheme}: 协议，图片请用 http(s) 或站内绝对路径。`
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
