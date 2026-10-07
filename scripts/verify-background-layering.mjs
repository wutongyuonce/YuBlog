/* global taskSpace */
// sed -e 's/__TASK_SPACE_ID__/<id>/g' -e 's|__BASE_URL__|<Local URL>|g' scripts/verify-background-layering.mjs | ego-browser nodejs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const task = await taskSpace(Number('__TASK_SPACE_ID__'))
const page = task.page('p1')
const base = new URL('__BASE_URL__').href

// Use a mobile viewport and freeze animation, not rendering.
await page.cdp('Emulation.setDeviceMetricsOverride', {
  width: 361,
  height: 651,
  deviceScaleFactor: 2,
  mobile: true,
})
await page.cdp('Emulation.setEmulatedMedia', {
  features: [
    { name: 'prefers-color-scheme', value: 'dark' },
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ],
})
await page.goto(base)
await page.evaluate(() => localStorage.setItem('theme', 'light'))
await page.reload()
await page.waitForFunction(() => !!document.querySelector('bg-dot')?.ctx)

const visibleDots = async () => {
  const background = await page.evaluate(() => {
    const body = getComputedStyle(document.body)
      .backgroundColor.match(/[\d.]+/g)
      .map(Number)
    return body[3] === 0
      ? getComputedStyle(document.documentElement)
          .backgroundColor.match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
      : body.slice(0, 3)
  })
  const path = await page.screenshot({ path: '/tmp/yublog-layering.png' })
  return page.evaluate(
    async ({ encoded, background }) => {
      // Decode the rendered screenshot, not the background's still-painted buffer.
      const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: 'image/png' })
      )
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(bitmap, 0, 0)
      const scale = bitmap.width / 361
      bitmap.close()
      // The left gutter contains only the background, not text or cards.
      const { data } = ctx.getImageData(
        0,
        Math.ceil(200 * scale),
        Math.floor(12 * scale),
        Math.floor(430 * scale)
      )
      let count = 0
      for (let i = 0; i < data.length; i += 4) {
        if (
          Math.abs(data[i] - background[0]) > 4 ||
          Math.abs(data[i + 1] - background[1]) > 4 ||
          Math.abs(data[i + 2] - background[2]) > 4
        )
          count++
      }
      return count
    },
    { encoded: (await readFile(path)).toString('base64'), background }
  )
}
try {
  assert.ok(
    (await visibleDots()) > 5,
    'control: dots must be visible with a transparent body'
  )
  const state = await page.evaluate(() => {
    document.body.style.setProperty('background-color', '#181a1b', 'important')
    const bg = document.querySelector('bg-dot')
    const pixels = bg.ctx.getImageData(
      0,
      0,
      bg.canvas.width,
      bg.canvas.height
    ).data
    let painted = 0
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) painted++
    return {
      painted,
      backgroundZ: getComputedStyle(bg).zIndex,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      isolation: getComputedStyle(document.body).isolation,
    }
  })
  assert.ok(
    state.painted > 0,
    'fixture: canvas pixels are painted even when the layer is hidden'
  )
  assert.equal(state.bodyBackground, 'rgb(24, 26, 27)')
  const visible = await visibleDots()
  console.log({ ...state, visiblePixels: visible })
  assert.ok(
    visible > 5,
    'an opaque body must not cover already-painted background dots'
  )

  await page.cdp('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: 'dark' },
      { name: 'prefers-reduced-motion', value: 'no-preference' },
    ],
  })
  await page.waitForFunction(
    () => document.querySelector('bg-dot')?.rafId !== null
  )
  assert.ok((await visibleDots()) > 5, 'animated dots must remain visible too')

  // Fixed decorations must remain viewport-relative after scrolling.
  const before = await page.evaluate(
    () => document.querySelector('bg-dot').getBoundingClientRect().top
  )
  await page.evaluate(() => window.scrollTo(0, 400))
  assert.equal(
    await page.evaluate(
      () => document.querySelector('bg-dot').getBoundingClientRect().top
    ),
    before
  )
  await page.evaluate(() => {
    window.scrollTo(0, 0)
    window.__layeringBody = document.body
    window.__layeringDocumentToken = true
  })
  await page.click('a[aria-label="归档"]')
  await page.waitForURL(base + 'archives/')
  assert.deepEqual(
    await page.evaluate(() => ({
      sameDocument: window.__layeringDocumentToken === true,
      replacedBody: document.body !== window.__layeringBody,
    })),
    { sameDocument: true, replacedBody: true },
    'exercise ClientRouter body replacement, not a full page load'
  )
  await page.waitForFunction(() => !!document.querySelector('bg-dot')?.ctx)
  await page.evaluate(() =>
    document.body.style.setProperty('background-color', '#181a1b', 'important')
  )
  assert.ok(
    (await visibleDots()) > 5,
    'replacement bodies must keep dots above an opaque body fill'
  )
} finally {
  await page.evaluate(() => {
    document.body.style.removeProperty('background-color')
    delete window.__layeringBody
    delete window.__layeringDocumentToken
  })
  await page.cdp('Emulation.setEmulatedMedia', { features: [] })
}
console.log('Painted dots remain visible above opaque body backgrounds: passed')
