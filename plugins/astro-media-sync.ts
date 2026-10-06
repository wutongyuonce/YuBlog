import {
  copyFileSync,
  existsSync,
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
 * 镜像整棵 `src/` 是安全的：视频/音频没有 Markdown 语法，凡是放在 `src/` 下的
 * 都只可能被 HTML 引用，不存在「已被图片管线处理过、再镜像一份」的重复。
 *
 * `public/_media/` 是派生产物，已在 .gitignore 中忽略。
 */

/**
 * 递归列出可以镜像的文件。判据与渲染期校验共用 `isMirrorableFile`：
 * 只接受真实普通文件，符号链接（含指向文件的）一律跳过。
 */
function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return []

  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    // 判据按当前遍历的根来算：镜像侧的路径不在源根下
    if (entry.isDirectory()) files.push(...listFiles(full))
    else if (isMirrorableFile(full, dir)) files.push(full)
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
  const sourceFiles = listFiles(roots.sourceRoot).filter((file) =>
    MEDIA_EXTENSIONS.has(path.extname(file).toLowerCase())
  )

  const mirror = new Map<string, string>()
  for (const source of sourceFiles) {
    const target = mediaTargetFor(source, roots)
    if (target) mirror.set(target, source)
  }

  let copied = 0
  for (const [target, source] of mirror) {
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
