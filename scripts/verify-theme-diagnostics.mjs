/* global taskSpace */
// sed 's/__TASK_SPACE_ID__/<id>/g' scripts/verify-theme-diagnostics.mjs | ego-browser nodejs
import assert from 'node:assert/strict'

const task = await taskSpace(Number('__TASK_SPACE_ID__'))
const page = task.page('p1')
const base = 'http://127.0.0.1:4322/'
await page.cdp('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  mobile: true,
})
await page.cdp('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
})
try {
  for (const query of ['', '?debug-theme=0']) {
    await page.goto(base + query)
    assert.equal(
      await page.evaluate(
        () =>
          performance
            .getEntriesByType('resource')
            .some((entry) => entry.name.includes('/debug/theme-v1.js')) ||
          !!document.getElementById('theme-diagnostics') ||
          !!window.__themeDiagnostics
      ),
      false,
      'ordinary visits must not load or install diagnostics'
    )
  }
  await page.goto(base + '?debug-theme=1')
  await page.waitForSelector('#theme-diagnostics')
  const firstSnapshot = await page.evaluate(
    () => document.querySelector('#theme-diagnostics pre').textContent
  )
  assert.match(
    firstSnapshot,
    /页面 complete/,
    'capture only after initial scripts finish loading'
  )
  assert.match(firstSnapshot, /组件注册：true/)
  assert.match(firstSnapshot, /上下文：已建立/)
  const passive = await page.evaluate(() => {
    const bg = document.querySelector('bg-dot')
    const canvas = bg.canvas
    const before = {
      theme: localStorage.getItem('theme'),
      classes: document.documentElement.className,
      width: canvas.width,
      height: canvas.height,
    }
    let draws = 0,
      contexts = 0,
      writes = 0,
      reads = 0
    const draw = bg.draw,
      getContext = canvas.getContext,
      setItem = Storage.prototype.setItem
    const getImageData = bg.ctx.getImageData
    bg.draw = () => draws++
    canvas.getContext = () => contexts++
    Storage.prototype.setItem = () => writes++
    bg.ctx.getImageData = function (...args) {
      reads++
      return getImageData.apply(this, args)
    }
    try {
      window.__themeDiagnostics.update()
      const text = document.querySelector('#theme-diagnostics pre').textContent
      const initialReads = reads
      document.dispatchEvent(new Event('astro:page-load'))
      return {
        before,
        after: {
          theme: localStorage.getItem('theme'),
          classes: document.documentElement.className,
          width: canvas.width,
          height: canvas.height,
        },
        draws,
        contexts,
        writes,
        initialReads,
        reads,
        text,
      }
    } finally {
      bg.draw = draw
      canvas.getContext = getContext
      Storage.prototype.setItem = setItem
      bg.ctx.getImageData = getImageData
    }
  })
  assert.deepEqual(
    passive.before,
    passive.after,
    'inspection must not alter theme or canvas dimensions'
  )
  assert.equal(
    passive.draws + passive.contexts + passive.writes,
    0,
    'inspection must not draw, create a context or save settings'
  )
  assert.equal(passive.initialReads, 1)
  assert.equal(
    passive.reads,
    1,
    'page-load must not overwrite the initial snapshot after the overlay appears'
  )
  assert.match(passive.text, /组件注册：true/)
  assert.match(passive.text, /上下文：已建立/)

  await page.evaluate(() => {
    const ctx = document.querySelector('bg-dot').ctx
    const original = ctx.getImageData
    try {
      ctx.getImageData = () => {
        throw new DOMException('Blocked', 'SecurityError')
      }
      window.__themeDiagnostics.update()
    } finally {
      ctx.getImageData = original
    }
  })
  assert.match(
    await page.evaluate(
      () => document.querySelector('#theme-diagnostics pre').textContent
    ),
    /像素读取：读取失败：SecurityError/,
    'denied pixel reads must be reported, not crash diagnostics'
  )

  await page.click('a[aria-label="归档"]')
  await page.waitForURL(base + 'archives/')
  await page.waitForFunction(
    () =>
      !document.getElementById('theme-diagnostics') &&
      !window.__themeDiagnostics
  )

  await page.cdp('Network.enable')
  await page.cdp('Network.setBlockedURLs', {
    urls: ['*Dot.astro_astro_type_script*', '*/backgrounds/Dot.astro*'],
  })
  try {
    await page.goto(base + '?debug-theme=1')
    await page.waitForSelector('#theme-diagnostics')
    const text = await page.evaluate(
      () => document.querySelector('#theme-diagnostics pre').textContent
    )
    assert.match(text, /组件注册：false/)
    assert.match(text, /上下文：无/)
    assert.match(text, /无已初始化上下文/)
  } finally {
    await page.cdp('Network.setBlockedURLs', { urls: [] })
  }
} finally {
  await page.cdp('Emulation.setEmulatedMedia', { features: [] })
}
console.log(
  'Opt-in diagnostics, passive reads, snapshot retention, failure reports and navigation cleanup: passed'
)
