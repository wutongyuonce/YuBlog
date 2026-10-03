import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * 全局样式表（每页都加载，或由布局统一引入）。
 * 组件 `<style>` 里再写一份同名选择器时，两份都会被加载，属主就不唯一了：
 * 组件那份被 Astro 加上 `[data-astro-cid-*]`，特异性更高，会静默压住全局那份，
 * 于是「改全局那份没反应」。
 */
const GLOBAL_SHEETS = [
  'public/shell.css',
  'src/styles/main.css',
  'src/styles/markdown.css',
  'src/styles/prose.css',
]

const root = fileURLToPath(new URL('..', import.meta.url))

/** 把注释替换成等长空白，保住行号。 */
const blankComments = (css) =>
  css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))

/** 取每条叶子规则的选择器（含 @media 等 at-rule 内部），带行号。 */
const selectorsOf = (css, lineOffset = 0) => {
  const source = blankComments(css)
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  const found = []
  let match

  while ((match = pattern.exec(source)) !== null) {
    const prelude = match[1].trim()
    if (!prelude || prelude.startsWith('@')) continue
    const line = lineOffset + source.slice(0, match.index).split('\n').length

    // :is() / :where() 中的逗号不分隔独立选择器。
    let depth = 0
    let start = 0
    for (let index = 0; index <= prelude.length; index += 1) {
      const char = prelude[index]
      if (char === '(' || char === '[') depth += 1
      if (char === ')' || char === ']') depth -= 1
      if (index === prelude.length || (char === ',' && depth === 0)) {
        const selector = prelude.slice(start, index).trim().replace(/\s+/g, ' ')
        if (selector) found.push({ selector, line })
        start = index + 1
      }
    }
  }

  return found
}

const styleBlocksOf = (astroSource) => {
  const pattern = /<style[^>]*>([\s\S]*?)<\/style>/g
  const blocks = []
  let match

  while ((match = pattern.exec(astroSource)) !== null) {
    blocks.push({
      css: match[1],
      lineOffset: astroSource.slice(0, match.index).split('\n').length - 1,
    })
  }

  return blocks
}

const collect = async () => {
  /** @type {Map<string, { file: string, line: number }[]>} */
  const owners = new Map()
  const add = (selector, owner) => {
    const list = owners.get(selector)
    if (list) list.push(owner)
    else owners.set(selector, [owner])
  }

  const globals = new Set()
  for (const sheet of GLOBAL_SHEETS) {
    const css = await readFile(path.join(root, sheet), 'utf8')
    for (const { selector, line } of selectorsOf(css)) {
      globals.add(selector)
      add(selector, { file: sheet, line })
    }
  }

  const entries = await readdir(path.join(root, 'src'), { recursive: true })
  for (const entry of entries) {
    if (!entry.endsWith('.astro')) continue
    const file = `src/${entry}`
    const source = await readFile(path.join(root, file), 'utf8')
    for (const block of styleBlocksOf(source)) {
      for (const { selector, line } of selectorsOf(block.css, block.lineOffset))
        add(selector, { file, line })
    }
  }

  return { owners, globals }
}

test('a selector is never owned by both a global sheet and a component style', async () => {
  const { owners, globals } = await collect()

  const clashes = []
  for (const [selector, list] of owners) {
    if (list.length < 2 || !globals.has(selector)) continue
    const inComponents = list.filter((owner) => owner.file.endsWith('.astro'))
    if (inComponents.length === 0) continue
    clashes.push({ selector, owners: list })
  }

  const report = clashes
    .map(
      ({ selector, owners: list }) =>
        `  ${selector}\n` +
        list.map(({ file, line }) => `      ${file}:${line}`).join('\n')
    )
    .join('\n')

  assert.equal(
    clashes.length,
    0,
    `同一选择器被全局样式表和组件 <style> 同时定义，属主不唯一：\n${report}\n\n` +
      '保留一份即可。组件那份会被作用域属性压过，改全局那份不会有反应。'
  )
})

test('the guard sees selectors inside at-rules and ignores comments', () => {
  const css = `
    /* .ignored { color: red } */
    .a, .b { color: red }
    .prose:is(.post-content, .interests-page__content) h2 { margin: 0 }
    @media (max-width: 480px) {
      .c:hover { color: blue }
    }
  `

  assert.deepEqual(
    selectorsOf(css).map((item) => item.selector),
    [
      '.a',
      '.b',
      '.prose:is(.post-content, .interests-page__content) h2',
      '.c:hover',
    ]
  )
})
