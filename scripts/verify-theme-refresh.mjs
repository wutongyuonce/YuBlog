/* global taskSpace */
// sed -e 's/__TASK_SPACE_ID__/<id>/g' -e 's|__BASE_URL__|<Local URL>|g' scripts/verify-theme-refresh.mjs | ego-browser nodejs
import assert from 'node:assert/strict'

const task = await taskSpace(Number('__TASK_SPACE_ID__'))
const page = task.page('p1')
const base = new URL('__BASE_URL__').href
const urlFor = (path) => new URL(path.replace(/^\//, ''), base).href

await page.cdp('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  mobile: true,
})
await page.goto(base)

const emulate = (system, motion = 'reduce') =>
  page.cdp('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: system },
      { name: 'prefers-reduced-motion', value: motion },
    ],
  })

const verify = async (theme, stage, checkSaved = true) => {
  const state = await page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'Canvas'
    document.body.append(probe)
    const nativeCanvas = getComputedStyle(probe).color
    probe.remove()
    let saved = null
    try {
      saved = localStorage.getItem('theme')
    } catch {
      // Storage-denied fixtures still need to inspect the rendered page.
    }
    const background = document.querySelector('bg-dot, bg-snow')
    const canvas = background?.querySelector('canvas')
    const pixels = canvas
      ?.getContext('2d')
      ?.getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    let sum = 0
    // Ignore near-transparent pixels where unpremultiplication is noisy.
    for (let i = 0; pixels && i < pixels.length; i += 4) {
      if (pixels[i + 3] <= 128) continue
      sum += pixels[i]
      count++
    }
    return {
      dark: document.documentElement.classList.contains('dark'),
      saved,
      checked: document
        .getElementById('theme-switch')
        ?.getAttribute('aria-checked'),
      meta: document.querySelector('meta[name="color-scheme"]')?.content,
      scheme: getComputedStyle(document.documentElement).colorScheme,
      nativeCanvas,
      palette: count ? sum / count : null,
    }
  })
  const dark = theme === 'dark'
  assert.equal(state.dark, dark, `${stage}: restore the selected theme`)
  if (checkSaved)
    assert.equal(state.saved, theme, `${stage}: persist the selected theme`)
  assert.equal(state.checked, String(dark), `${stage}: sync the switch`)
  assert.equal(state.meta, theme, `${stage}: advertise only the active theme`)
  const schemes = state.scheme.split(' ')
  assert.ok(schemes.includes(theme), `${stage}: CSS follows the selected theme`)
  assert.ok(
    schemes.includes('only'),
    `${stage}: do not auto-darken custom colors`
  )
  const channels = state.nativeCanvas.match(/\d+/g).slice(0, 3).map(Number)
  const brightness = channels.reduce((sum, channel) => sum + channel, 0) / 3
  assert.equal(
    brightness < 128,
    dark,
    `${stage}: browser-native colors must not override a saved theme`
  )
  if (!new URL(await page.url()).pathname.endsWith('/about/'))
    assert.notEqual(state.palette, null, `${stage}: initialize the background`)
  return state.palette
}

const toggle = async (theme) => {
  await page.click('#theme-switch')
  await page.waitForFunction(
    (theme) =>
      document.documentElement.classList.contains('dark') ===
        (theme === 'dark') &&
      !document.documentElement.classList.contains('theme-switching'),
    theme
  )
}

const navigate = async (path) => {
  await page.evaluate((href) => {
    // Exercise ClientRouter with a real click rather than page.goto().
    window.__themeDocumentToken = 'same-document'
    window.__themeOldBackground = document.querySelector('bg-dot, bg-snow')
    const link = document.createElement('a')
    link.id = 'theme-test-link'
    link.href = href
    link.textContent = 'Theme navigation check'
    link.style.cssText = 'position:fixed;top:120px;left:0;z-index:99999'
    document.body.append(link)
  }, urlFor(path))
  await page.click('#theme-test-link')
  await page.waitForURL(urlFor(path))
  await page.waitForFunction(() => !document.querySelector('#theme-test-link'))
  const lifecycle = await page.evaluate(() => ({
    sameDocument: window.__themeDocumentToken === 'same-document',
    detached: !window.__themeOldBackground?.isConnected,
    rafStopped:
      !window.__themeOldBackground ||
      window.__themeOldBackground.rafId === null,
    observerStopped:
      !window.__themeOldBackground ||
      window.__themeOldBackground.cleanupTheme === null,
  }))
  for (const [name, passed] of Object.entries(lifecycle))
    assert.equal(passed, true, `${path}: ${name}`)
}

// Compare actual pixels to a fresh-load reference, not fixed design colors.
const palettes = { '/': {}, '/friends/': {} }
try {
  await emulate('dark')
  for (const path of Object.keys(palettes)) {
    await page.goto(urlFor(path))
    for (const theme of ['light', 'dark']) {
      await page.evaluate(
        (theme) => localStorage.setItem('theme', theme),
        theme
      )
      await page.reload()
      palettes[path][theme] = await verify(theme, `${path}/${theme}/reference`)
    }
    assert.ok(
      Math.abs(palettes[path].dark - palettes[path].light) > 10,
      `${path}: themes must draw distinguishable colors`
    )
  }
  const checkPalette = (actual, path, theme, stage) => {
    assert.ok(
      Math.abs(actual - palettes[path][theme]) < 3,
      `${stage}: background pixels follow the current theme`
    )
  }

  await page.goto(base)
  for (const motion of ['reduce', 'no-preference']) {
    for (const system of ['dark', 'light']) {
      await emulate(system, motion)
      // First visit and malformed values both fall back to the system.
      for (const saved of [null, 'invalid-theme']) {
        await page.evaluate((saved) => {
          if (saved === null) localStorage.removeItem('theme')
          else localStorage.setItem('theme', saved)
        }, saved)
        await page.reload()
        await verify(system, `${motion}/${system}/fallback/${saved}`)
      }
      for (const selected of ['light', 'dark']) {
        await page.evaluate(
          (theme) => localStorage.setItem('theme', theme),
          selected
        )
        await page.reload()
        await verify(selected, `${motion}/${system}/${selected}/load`)
        const toggled = selected === 'dark' ? 'light' : 'dark'
        await toggle(toggled)
        checkPalette(
          await verify(toggled, `${motion}/${system}/${selected}/toggle`),
          '/',
          toggled,
          'theme toggle'
        )
        await page.reload()
        await verify(toggled, `${motion}/${system}/${selected}/toggle-reload`)
      }
    }
    for (const selected of ['dark', 'light']) {
      await emulate(selected, motion)
      await page.evaluate(
        (theme) => localStorage.setItem('theme', theme),
        selected
      )
      await page.reload()
      for (const path of ['/archives/', '/friends/', '/about/', '/']) {
        await navigate(path)
        const palette = await verify(
          selected,
          `${motion}/${selected}/navigate${path}`
        )
        if (path !== '/about/')
          checkPalette(
            palette,
            path === '/friends/' ? path : '/',
            selected,
            path
          )
      }
      // Preserve the existing policy: system changes update the current theme.
      const nextSystem = selected === 'dark' ? 'light' : 'dark'
      await emulate(nextSystem, motion)
      await page.waitForFunction(
        (theme) => localStorage.getItem('theme') === theme,
        nextSystem
      )
      checkPalette(
        await verify(nextSystem, `${motion}/system-change`),
        '/',
        nextSystem,
        'system preference change'
      )
    }
  }

  await emulate('dark')
  for (const mode of ['read', 'write']) {
    await page.evaluate(() => localStorage.setItem('theme', 'light'))
    const hook = await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__themeErrors = [];
        window.addEventListener('error', e => window.__themeErrors.push(e.message));
        window.addEventListener('unhandledrejection', e => window.__themeErrors.push(String(e.reason)));
        const method = '${mode === 'read' ? 'getItem' : 'setItem'}';
        const original = Storage.prototype[method];
        Storage.prototype[method] = function (key, ...args) {
          if (key === 'theme') throw new DOMException('Theme storage disabled', 'SecurityError');
          return Reflect.apply(original, this, [key, ...args]);
        };`,
    })
    try {
      await page.reload()
      const initial = mode === 'read' ? 'dark' : 'light'
      await verify(initial, `${mode}-denied/load`, false)
      const selected = initial === 'dark' ? 'light' : 'dark'
      await toggle(selected)
      await verify(selected, `${mode}-denied/toggle`, false)
      assert.deepEqual(
        await page.evaluate(() => window.__themeErrors),
        [],
        `${mode}-denied: no uncaught errors during load or toggle`
      )
      await page.reload()
      await verify(initial, `${mode}-denied/reload`, false)
      assert.deepEqual(
        await page.evaluate(() => window.__themeErrors),
        [],
        `${mode}-denied: no uncaught storage errors`
      )
    } finally {
      await page.cdp('Page.removeScriptToEvaluateOnNewDocument', {
        identifier: hook.identifier,
      })
      await page.reload()
    }
  }
} finally {
  await page.cdp('Emulation.setEmulatedMedia', { features: [] })
}
console.log(
  'Theme restoration, refresh, native colors, background pixels, navigation and storage failures: passed'
)
