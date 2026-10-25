/* global taskSpace */
// sed -e 's/__TASK_SPACE_ID__/<id>/g' -e 's|__BASE_URL__|http://127.0.0.1:4333/|g' scripts/verify-prose-overflow.mjs | ego-browser nodejs
// 在仓库服务启动后复用现有 TaskSpace；BASE 需包含部署 base。
import assert from 'node:assert/strict'

const task = await taskSpace(Number('__TASK_SPACE_ID__'))
const page = task.page('p1')
const base = '__BASE_URL__'

// 长行内代码与超宽公式仅使用真实文章；原生 pre/code 另以最小样例检查。
let checkedCode = false
let checkedWideMath = false
for (const slug of ['image-layout-demo', '英伟达的护城河究竟是什么']) {
  await page.goto(new URL(`blogs/${encodeURIComponent(slug)}/`, base).href)
  await page.waitForSelector('.prose .katex-display')
  await page.cdp('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  assert.equal(await page.evaluate(() => innerWidth), 390)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  const state = await page.evaluate(() => {
    // 不能只靠根 overflow 断言：clip 会产生假阴性，必须同时检查内容可访问。
    const rootFits = () =>
      document.documentElement.scrollWidth <= innerWidth &&
      document.scrollingElement.scrollWidth <= innerWidth
    const nav = document
      .querySelector('.nav-bar__inner')
      .getBoundingClientRect()
    const code = [...document.querySelectorAll('.prose code')]
      .filter((node) => !node.closest('pre') && node.textContent.length >= 50)
      .sort((a, b) => b.textContent.length - a.textContent.length)[0]
    let codeAccessible = null
    if (code) {
      code.scrollIntoView({ block: 'center' })
      const container = code.closest('p, li') || code.parentElement
      const bounds = container.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(code)
      const rects = [...range.getClientRects()]
      codeAccessible =
        rects.length > 0 &&
        rects.every(
          (rect) =>
            rect.width > 0 &&
            rect.left >= Math.max(0, bounds.left) - 1 &&
            rect.right <= Math.min(innerWidth, bounds.right) + 1
        ) &&
        new Set(rects.map((rect) => Math.round(rect.top))).size > 1
    }
    const formulas = [...document.querySelectorAll('.prose .katex-display')]
    const wide = formulas.filter((node) => node.scrollWidth > node.clientWidth)
    const mathAccessible = wide.every((node) => {
      node.scrollIntoView({ block: 'center' })
      node.scrollLeft = node.scrollWidth
      const bounds = node.getBoundingClientRect()
      // 检查可视公式的最后一个字形，避免只验证滚动数值而内容仍被裁掉。
      const leaves = [...node.querySelectorAll('.katex-html *')].filter(
        (child) => !child.children.length && child.textContent.trim()
      )
      const end = Math.max(
        ...leaves.map((child) => child.getBoundingClientRect().right)
      )
      const accessible =
        node.scrollLeft > 0 &&
        Math.abs(node.scrollWidth - node.clientWidth - node.scrollLeft) <= 1 &&
        bounds.width > 0 &&
        end > bounds.left &&
        end <= bounds.right + 1 &&
        rootFits()
      node.scrollLeft = 0
      return accessible
    })
    return {
      rootFits: rootFits(),
      navFits: nav.left >= 0 && nav.right <= innerWidth,
      codeAccessible,
      wideCount: wide.length,
      mathAccessible,
    }
  })
  assert.ok(state.rootFits, `${slug}：页面根不横撑`)
  assert.ok(state.navFits, `${slug}：顶栏在视口内`)
  if (state.codeAccessible !== null) {
    checkedCode = true
    assert.ok(state.codeAccessible, `${slug}：长行内代码换行且完整可见`)
  }
  checkedWideMath ||= state.wideCount > 0
  assert.ok(state.mathAccessible, `${slug}：宽公式可局部滚动至末端`)
}
// Plain pre/code is a separate CSS contract from Expressive Code's fenced blocks.
assert.equal(
  await page.evaluate(() => {
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.textContent = 'first line\n    indented second line\n\tthird line'
    pre.append(code)
    document.querySelector('.post-content').append(pre)
    const preserved = code.innerText === code.textContent
    pre.remove()
    return preserved
  }),
  true,
  '原生 pre/code 保留换行与缩进，不套用行内代码的换行规则'
)
assert.ok(checkedCode, '真实文章必须覆盖长行内代码')
assert.ok(checkedWideMath, '真实文章必须覆盖超宽公式，避免空检查通过')
// Native controls and embed dimensions must fit their actual prose container.
for (const width of [600, 390, 320]) {
  await page.cdp('Emulation.setDeviceMetricsOverride', {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const media = await page.evaluate(() => {
    const container = document.createElement('blockquote')
    container.innerHTML =
      '<audio controls></audio><iframe width="560" height="315" src="about:blank"></iframe><iframe class="rds-video" src="about:blank"></iframe>'
    document.querySelector('.post-content').append(container)
    const bounds = container.getBoundingClientRect()
    const fits = [...container.querySelectorAll('audio, iframe')].every(
      (node) => {
        const rect = node.getBoundingClientRect()
        return (
          rect.width > 0 &&
          rect.left >= bounds.left - 1 &&
          rect.right <= bounds.right + 1
        )
      }
    )
    container.remove()
    return fits
  })
  assert.ok(
    media,
    `${width}px: native audio and embedded frames stay inside prose`
  )
}
console.log('窄屏正文防撑宽与内容可访问检查通过')
