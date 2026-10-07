import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  rmdirSync,
  statSync,
  utimesSync,
} from 'node:fs'
import path from 'node:path'

import {
  isMirrorableFile,
  mediaTargetFor,
  MEDIA_EXTENSIONS,
  MEDIA_ROOTS,
} from './media-paths.ts'

import type { MediaRoots } from './media-paths.ts'
import type { AstroIntegration } from 'astro'

/**
 * 把 `src/` 下的视频/音频镜像到 `public/_media/`，让 `rehype-media-assets`
 * 改写出来的 `/_media/…` 地址真的能取到文件。目标路径由 `mediaTargetFor` 推导，
 * 本模块不自己拼映射。
 *
 * 必须在 `astro:config:setup` 里同步完成：Astro 拷贝 `public/` 发生在构建早期，
 * 如果等到渲染文章时才落盘，产物里的文件会缺失。这里没有文件监听，所以 dev
 * 运行期间新加的视频要重启 dev（或重新构建）才会出现。
 *
 * 遍历 `src/` 时只镜像视频/音频，供 HTML、媒体链接与媒体卡片引用；图片继续由
 * Astro 图片管线处理，避免重复复制。
 *
 * `public/_media/` 是派生产物，已在 .gitignore 中忽略。
 */

/**
 * 递归列出非目录条目（含符号链接），但不进入链接目录。
 * 源侧另用 `isMirrorableFile` 拒绝链接，目标侧必须看到链接才能清理它们。
 */
function listFiles(dir: string): string[] {
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) return []

  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(full))
    else files.push(full)
  }
  return files
}

/**
 * 目标与源完全一致时不必重写：大小相同且 mtime 相同（按毫秒取整）。
 * 复制后会把目标的 mtime 对齐到源；utimes 只保留毫秒精度，而源的 mtimeMs
 * 带亚毫秒小数，所以按毫秒比较。只有大小相同但 mtime 不同时才会重写。
 */
function isUpToDate(source: string, target: string) {
  if (!existsSync(target)) return false

  const sourceStat = statSync(source)
  const targetStat = statSync(target)
  return (
    sourceStat.size === targetStat.size &&
    Math.round(sourceStat.mtimeMs) === Math.round(targetStat.mtimeMs)
  )
}

/**
 * 清掉目标路径上的符号链接，只删链接本身（unlink 不会动它指向的内容），
 * 之后由 mkdirSync／copyFileSync 建出真实目录与文件。
 *
 * 为什么必须做：`statSync` 与 `copyFileSync` 会跟随链接。镜像目录虽是派生产物，
 * 但只要里面有一条手工塞进来的链接，复制就会写到镜像根之外的文件上，还会改它的
 * mtime —— 实测「目标是指向别处的链接」时，外部文件被改名成源媒体内容。
 * 路径中间是普通文件时同样清掉；末段是旧目录而当前要写文件时，删除派生目录
 * 再复制，以便源目录切换成同名文件后自动恢复。
 */
function ensureRealPath(target: string, root: string) {
  const segments = path.relative(root, target).split(path.sep)
  let current = root

  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment)
    let stats
    try {
      stats = lstatSync(current)
    } catch {
      return // 还没建出来，交给 mkdirSync／copyFileSync
    }
    const isLast = index === segments.length - 1
    if (
      stats.isSymbolicLink() ||
      (!isLast && !stats.isDirectory()) ||
      (isLast && stats.isDirectory())
    )
      rmSync(current, { recursive: stats.isDirectory(), force: true })
  }
}

/**
 * 镜像根自己必须是真实目录：它若是符号链接，`copyFileSync` 与清理用的 `rmSync`
 * 都会作用到链接指向的外部目录（会改写并删除那里的文件）。派生目录完全属于本模块，
 * 所以发现链接就删掉链接本身再重建。
 */
function ensureRealRoot(root: string) {
  try {
    if (lstatSync(root).isSymbolicLink()) rmSync(root, { force: true })
  } catch {
    // 还不存在：交给后面的 mkdirSync
  }
}

/** 删除没有内容的目录，但保留镜像根目录本身 */
function pruneEmptyDirs(dir: string, root: string) {
  if (!existsSync(dir)) return

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) pruneEmptyDirs(path.join(dir, entry.name), root)
  }
  if (dir !== root && readdirSync(dir).length === 0) rmdirSync(dir)
}

/** 同步一次，返回本次实际发生的变更数量 */
export function syncMedia(roots: MediaRoots = MEDIA_ROOTS) {
  // 必须先做：否则清理步骤会跟着链接删掉外部目录里的文件
  ensureRealRoot(roots.publicDir)

  const sourceFiles = listFiles(roots.sourceRoot).filter(
    (file) =>
      MEDIA_EXTENSIONS.has(path.extname(file).toLowerCase()) &&
      isMirrorableFile(file, roots.sourceRoot)
  )

  const mirror = new Map<string, string>()
  for (const source of sourceFiles) {
    const target = mediaTargetFor(source, roots)
    if (target) mirror.set(target, source)
  }

  let copied = 0
  for (const [target, source] of mirror) {
    // 先清链接再判「是否最新」：目标是指向别处的链接时，大小与 mtime 可能恰好一致，
    // 一旦先命中早退，链接就会永久留在产物里，站点一直在提供镜像根之外的文件。
    ensureRealPath(target, roots.publicDir)
    if (isUpToDate(source, target)) continue
    mkdirSync(path.dirname(target), { recursive: true })
    copyFileSync(source, target)
    // 对齐 mtime，下一个构建才能用相等比较判断是否要重写
    const { atime, mtime } = statSync(source)
    utimesSync(target, atime, mtime)
    copied++
  }

  let removed = 0
  for (const target of listFiles(roots.publicDir)) {
    if (mirror.has(target)) continue
    // force：另一个进程可能已经删掉了它，此处不需要报错
    rmSync(target, { force: true })
    removed++
  }
  pruneEmptyDirs(roots.publicDir, roots.publicDir)

  return { total: mirror.size, copied, removed }
}

export function mediaSyncIntegration(): AstroIntegration {
  return {
    name: 'yublog:media-sync',
    hooks: {
      'astro:config:setup': ({ logger }) => {
        const { total, copied, removed } = syncMedia()
        if (copied || removed)
          logger.info(
            `媒体镜像：共 ${total} 个文件，更新 ${copied} 个，清理 ${removed} 个`
          )
      },
    },
  }
}
