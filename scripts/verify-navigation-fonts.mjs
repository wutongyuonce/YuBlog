/* global taskSpace */
// Replace __TASK_SPACE_ID__ and __BASE_URL__, then pipe this file to ego-browser nodejs.
import assert from 'node:assert/strict'

const task = await taskSpace(Number('__TASK_SPACE_ID__'))
const page = task.page('p1')
const base = new URL('__BASE_URL__')
await page.goto(new URL('interests/', base).href)
await page.evaluate(() => {
  window.__sharedStylesheet = document.getElementById('site-styles')
})
assert.equal(await page.evaluate(() => !!window.__sharedStylesheet), true)
await page.cdp('Network.enable')
// Expose font reconstruction even when the HTTP cache would mask the flash.
await page.cdp('Network.setCacheDisabled', { cacheDisabled: true })
try {
  await page.evaluate(async () => {
    const fonts = [
      ['400 28px "SourceHanSerifCN-Regular"', 'WutongRain 梧桐雨'],
      ['400 16px Inter', 'Reading text 123'],
      ['600 16px Inter', 'Reading text 123'],
      ['800 16px Inter', 'Reading text 123'],
      ['400 16px "DM Mono"', 'const answer = 42'],
    ]
    const loaded = await Promise.all(
      fonts.map(([font, text]) => document.fonts.load(font, text))
    )
    if (loaded.some((faces) => faces.length === 0))
      throw new Error('The shared text font declarations must exist')
    await document.fonts.ready
    window.__measureNavigationFonts = () => {
      const context = document.createElement('canvas').getContext('2d')
      return fonts.map(([font, text]) => {
        context.font = font
        return { font, width: context.measureText(text).width }
      })
    }
  })
  for (const label of ['关于', '项目', '归档', '标签', '文稿', '拾趣']) {
    const before = await page.evaluate(() => {
      window.__navigationFonts = null
      document.addEventListener(
        'astro:after-swap',
        () => {
          window.__navigationFonts = window.__measureNavigationFonts()
        },
        { once: true }
      )
      return window.__measureNavigationFonts()
    })
    await page.click(`header a[aria-label="${label}"]`)
    await page.waitForFunction(() => window.__navigationFonts !== null)
    const after = await page.evaluate(() => window.__navigationFonts)
    assert.equal(
      await page.evaluate(
        () =>
          document.getElementById('site-styles') === window.__sharedStylesheet
      ),
      true,
      `${label}: keep the existing shared stylesheet node`
    )
    assert.deepEqual(
      after,
      before,
      `${label}: loaded text must not switch to fallback fonts on swap`
    )
    await page.waitForFunction(
      () => !document.documentElement.hasAttribute('data-astro-transition')
    )
  }
  console.log(
    'Shared stylesheet and text fonts remain stable across six page swaps'
  )
} finally {
  await page.cdp('Network.setCacheDisabled', { cacheDisabled: false })
  await page.evaluate(() => {
    delete window.__measureNavigationFonts
    delete window.__navigationFonts
    delete window.__sharedStylesheet
  })
}
