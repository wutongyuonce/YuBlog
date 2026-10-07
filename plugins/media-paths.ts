import { lstatSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { SITE } from '../src/config.ts'

/**
 * 正文媒体引用的路径规则。
 *
 * 环境里有两个「根」，作者不需要知道它们的区别，但代码必须知道：
 *
 * - Typora 按 **Markdown 文件所在目录** 解析相对路径。所以作者把 `demo.mp4`
 *   放在 `foo.md` 旁边，写 `./demo.mp4`，在 Typora 里能预览。
 * - 站点按 **URL** 解析。文章 `src/content/blogs/<id>.md` 的 URL 是
 *   `/blogs/<id>/`，比源文件目录多一层 `<id>/`，所以 `./demo.mp4` 在站上必然 404。
 *
 * 本模块负责把前者翻译成后者：`src/` 目录树镜像到 `public/_media/`
 * （由 `astro-media-sync.ts` 落盘），相对引用改写成 `/_media/<相对 src/ 的路径>`。
 * 改写、镜像、校验都调用这里的函数，不各自推断映射或协议白名单。
 *
 * 为什么只覆盖视频/音频：图片有 Markdown 语法 `![](./x.png)`，由 Astro 图片管线
 * 处理（优化 + srcset），源文件在 `dist/_astro/` 里已有一份。镜像整棵 `src/`
 * （当前 144MB 图片）到 `public/_media/` 只会让产物翻倍。视频/音频没有 Markdown
 * 语法，只能走 HTML，所以全部由本站服务，不存在重复。
 */

/** 需要镜像到 `public/_media/` 的扩展名。图片不在其中，见模块注释。 */
export const MEDIA_EXTENSIONS = new Set([
  '.mp4',
  '.webm',
  '.ogv',
  '.mov',
  '.m4v',
  '.mp3',
  '.m4a',
  '.ogg',
  '.oga',
  '.wav',
  '.flac',
])

/**
 * `src` 必须可服务的元素。渲染期改写与产物校验都从这里取，
 * 避免两边各自维护一份列表而漏掉某个标签。
 *
 * 注意 `track` 也在列表里，但字幕文件（`.vtt`）不能被镜像 —— 它的扩展名不在
 * `MEDIA_EXTENSIONS` 里，所以相对路径的字幕会报错，要放进 `public/` 用站内绝对路径
 * 引用。放在这里是为了让 `file:` 这类地址至少会被拦下。
 */
export const MEDIA_SRC_ELEMENTS = ['video', 'audio', 'source', 'track']

/** 镜像源：项目根下的 `src/` */
export const MEDIA_SOURCE_ROOT = fileURLToPath(
  new URL('../src/', import.meta.url)
)

/** 镜像目标：`public/` 会被 Astro 原样拷进产物根 */
export const MEDIA_PUBLIC_DIR = fileURLToPath(
  new URL('../public/_media/', import.meta.url)
)

/** 镜像后的 URL 前缀。跟随站点 base，子路径部署时才不会请求到错误位置。 */
export const MEDIA_URL_PREFIX = `${SITE.base.replace(/\/+$/, '')}/_media/`

/** 镜像的两个根。默认取真实项目路径；测试注入临时目录，以便隔离。 */
export interface MediaRoots {
  sourceRoot: string
  publicDir: string
}

export const MEDIA_ROOTS: MediaRoots = {
  sourceRoot: MEDIA_SOURCE_ROOT,
  publicDir: MEDIA_PUBLIC_DIR,
}

/** `data:` 之外还允许出现的协议名（不含冒号）：只有 HTTP(S) 能在站上打开 */
const HTTP_SCHEME = /^https?$/i
const SCHEME = /^([a-z][a-z0-9+.-]*):/i

/** 站上能直接打开的地址类型。渲染期与产物校验共用这一套判断。 */
export type MediaUrlKind =
  /** `http(s)://` 或 `//host/…`：外链 */
  | { kind: 'external' }
  /** `/…`：作者自己放进 `public/` */
  | { kind: 'rooted' }
  /** `data:`：内容被内联成字符串，没有文件可服务 */
  | { kind: 'inline' }
  /** 其它协议（`file:`、`blob:` 等）：浏览器在站上打不开 */
  | { kind: 'unsupported'; scheme: string }
  /** 其余一律按相对于 Markdown 文件的路径处理 */
  | { kind: 'relative' }

/** 一条媒体引用的判定结果：站点级地址分类，或相对路径的两种去向 */
export type MediaRef =
  | Exclude<MediaUrlKind, { kind: 'relative' }>
  /** 相对路径且落在源根下：可镜像，给出源文件和目标 URL */
  | { kind: 'local'; file: string; url: string }
  /** 相对路径但逃出了源根：镜像不到，无法服务 */
  | { kind: 'outside'; file: string }

/** 只按协议分类，不涉及文件系统。渲染期与产物校验都调用它。 */
export function classifyMediaUrl(rawSrc: string): MediaUrlKind {
  const src = rawSrc.trim()

  if (/^data:/i.test(src)) return { kind: 'inline' }
  if (src.startsWith('//')) return { kind: 'external' }

  const scheme = SCHEME.exec(src)?.[1]
  if (scheme)
    return HTTP_SCHEME.test(scheme)
      ? { kind: 'external' }
      : { kind: 'unsupported', scheme: scheme.toLowerCase() }

  if (src.startsWith('/')) return { kind: 'rooted' }
  return { kind: 'relative' }
}

/**
 * 按浏览器的方式把 URL 路径还原成文件名：逐段解码，这样 `%20`、`%23`
 * 这些转义都能还原成真实字符（`decodeURI` 不会解码保留字符）。
 */
export function decodeMediaPath(value: string): string {
  return value
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
    .join('/')
}

/** 反向操作：逐段编码，`%`、`#`、`?`、空格在 URL 里都有确定含义。 */
function encodeMediaPath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/')
}

/** 取出 `?query`／`#fragment`。它们不属于文件名，改写时要原样拼回（如 `#t=10`）。 */
export function mediaSuffix(value: string): string {
  const index = value.search(/[?#]/)
  return index === -1 ? '' : value.slice(index)
}

/**
 * 相对路径是否指向根之内。`..` 只有作为**路径段**才算越界：
 * 不能用 `startsWith('..')`，它会把根目录下名叫 `..clip.mp4` 的真实文件判成越界。
 * 这正是三个映射函数与枚举步调不一致的原因：同一个文件相对源根是
 * `content/blogs/..clip.mp4`（放行），相对所在目录却是 `..clip.mp4`（拒绝），
 * 于是渲染通过、镜像没做、站上 404。
 */
function isInsideRelative(relative: string): boolean {
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

/**
 * 相对 `root` 的路径里哪一段含 `#` 或 `?`（没有任何一段则返回 null）。
 *
 * 这两个字符在 `src` 里属于 URL 语法，引用只能写成 `%23`／`%3F`；服务器拿到请求后
 * 虽然会把它们解码回字面名字，但已经先按 `#`／`?` 截断过路径，于是 404。
 * 新建的 dev 与 preview 上都实测过（`a%23b.mp4` 404、`plain.mp4` 200），
 * 叶子名与父目录名一样取不到，所以目录段也要查。同目录下 `%`（写 `%25`）、
 * 空格（写 `%20`）、中文都能正常取到，所以只拦这两个字符。
 *
 * 只在**相对源根**的路径上判断：项目目录名里带 `?` 不该误伤。
 *
 * 复测时注意别把夹具做坏：同一目录里若同时存在字面叫 `a%23b.mp4` 的文件，
 * 请求 `a%23b.mp4` 会命中那个字面名而返回 200，看起来像「`#` 其实能服务」。
 */
export function findUnservableSegment(
  file: string,
  root: string = MEDIA_SOURCE_ROOT
): string | null {
  const relative = path.relative(root, file)
  if (!isInsideRelative(relative)) return null
  return (
    relative.split(path.sep).find((segment) => /[?#]/.test(segment)) ?? null
  )
}

/** 把绝对路径换算成 `/_media/` 下的 URL；不在源根下时返回 null */
export function mediaUrlFor(
  absoluteFile: string,
  roots: MediaRoots = MEDIA_ROOTS
): string | null {
  const relative = path.relative(roots.sourceRoot, absoluteFile)
  if (!isInsideRelative(relative)) return null
  return MEDIA_URL_PREFIX + encodeMediaPath(relative.split(path.sep).join('/'))
}

/** 把源根下的绝对路径换算成镜像目标路径；不在源根下时返回 null */
export function mediaTargetFor(
  absoluteFile: string,
  roots: MediaRoots = MEDIA_ROOTS
): string | null {
  const relative = path.relative(roots.sourceRoot, absoluteFile)
  if (!isInsideRelative(relative)) return null
  return path.join(roots.publicDir, relative)
}

/**
 * 能否被镜像：`root` 下的真实普通文件，且**从 `root` 到它的每一段路径都不是符号链接**。
 * 枚举不会进入链接（避免镜像成环），校验若只看叶子就会放行一个没有产物的 URL，
 * 所以两侧必须共用这一条判据；镜像侧传入镜像根，不要用源根去相对化。
 */
export function isMirrorableFile(
  file: string,
  root: string = MEDIA_SOURCE_ROOT
): boolean {
  const relative = path.relative(root, file)
  if (!isInsideRelative(relative)) return false

  try {
    if (!lstatSync(file).isFile()) return false
    // 路径里出现链接时，真实路径与字面路径不一致
    return realpathSync(file) === path.join(realpathSync(root), relative)
  } catch {
    return false
  }
}

/** 判定一条媒体引用。除路径映射外不访问文件系统。 */
export function classifyMediaRef(
  rawSrc: string,
  markdownPath: string,
  roots: MediaRoots = MEDIA_ROOTS
): MediaRef {
  const src = rawSrc.trim()
  const url = classifyMediaUrl(src)
  if (url.kind !== 'relative') return url

  // `?query` 与 `#fragment` 不属于文件名；`#t=10` 是合法的媒体片段
  const [pathname = ''] = src.split(/[?#]/)
  const file = path.resolve(
    path.dirname(markdownPath),
    decodeMediaPath(pathname)
  )
  const target = mediaUrlFor(file, roots)
  return target
    ? { kind: 'local', file, url: target }
    : { kind: 'outside', file }
}
