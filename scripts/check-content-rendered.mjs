#!/usr/bin/env node
/**
 * 构建后校验：每个带正文容器的页面都必须真的渲染出了正文。
 *
 * 为什么需要它：Astro 的内容加载器会捕获单篇文章的渲染异常、记一条日志后继续，
 * 并把这一条以**空正文**存进内容集合。只有消费了渲染结果的页面才会跟着失败 ——
 * 博客靠写作热力图间接失败，而拾趣、关于没有这样的调用方，于是构建成功、
 * 页面空白、内容悄悄丢失。部署只跑 `pnpm build`，不跑测试，所以这道校验必须
 * 留在构建链里。
 *
 * 判据是「容器里没有任何元素子节点、也没有非空白文本」：渲染失败时容器是真正
 * 空的，而只有一张图或一段视频的正文会留下元素子节点，不会被误判。
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { fromHtml } from 'hast-util-from-html'
import { visit } from 'unist-util-visit'

const DIST = join(process.cwd(), 'dist')
const CONTENT_CLASS = 'markdown-content'

/** 递归列出产物里的 HTML 页面 */
async function listPages(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => join(entry.parentPath ?? dir, entry.name))
}

/** 有意义的子节点：元素，或非空白文本。注释与空白不算。 */
const isMeaningful = (child) =>
  child.type === 'element' ||
  (child.type === 'text' && child.value.trim() !== '')

/**
 * 页面上每个空的正文容器；页面没有正文容器时返回 null。
 * 逐个容器判断而不是「全都空才算空」：一页里有两个独立正文时（首页的正文与拾趣精选），
 * 只要求「至少一个非空」会让另一个静默丢内容。
 */
function emptyBodies(html) {
  const tree = fromHtml(html, { fragment: true })
  const bodies = []
  visit(tree, 'element', (node) => {
    const classes = node.properties?.className
    if (Array.isArray(classes) && classes.includes(CONTENT_CLASS))
      bodies.push(node)
  })
  if (bodies.length === 0) return null
  return bodies.filter(
    (node) => (node.children ?? []).filter(isMeaningful).length === 0
  ).length
}

const pages = await listPages(DIST)
const empty = []
let checked = 0

for (const page of pages) {
  // 直接按 DOM 判定，不做字符串粗筛：class 写成实体（markdown&#45;content）时
  // 粗筛会跳过整页，而 DOM 里它就是 markdown-content
  const emptyCount = emptyBodies(await readFile(page, 'utf8'))
  if (emptyCount === null) continue

  checked++
  if (emptyCount > 0) empty.push(relative(DIST, page))
}

if (empty.length > 0) {
  console.error('ERROR: 以下页面的正文容器是空的：')
  for (const page of empty) console.error(`  - ${page}`)
  console.error(
    '正文有内容却渲染失败时，往上找构建日志里的 [glob-loader] 报错；' +
      '内容本来就不该有正文时，不要使用 markdown-content 容器。'
  )
  process.exit(1)
}

console.log(`内容渲染校验：${checked} 个带正文的页面均已渲染出内容。`)
