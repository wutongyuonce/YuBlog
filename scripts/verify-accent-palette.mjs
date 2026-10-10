/* global taskSpace */
// sed -e 's/__TASK_SPACE_ID__/<id>/g' -e 's|__BASE_URL__|<Local URL>|g' scripts/verify-accent-palette.mjs | ego-browser nodejs
import assert from 'node:assert/strict'

const task = await taskSpace(Number('__TASK_SPACE_ID__'))
const page = task.page('p1')
const base = new URL('__BASE_URL__').href
const urlFor = (path) => new URL(path.replace(/^\//, ''), base).href

await page.goto(base)
const saved = await page.evaluate(() => ({
  accent: localStorage.getItem('accent-palette'),
  theme: localStorage.getItem('theme'),
}))

const viewport = async (width, touch = false) => {
  await page.cdp('Emulation.setDeviceMetricsOverride', {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: touch,
  })
  await page.cdp('Emulation.setTouchEmulationEnabled', { enabled: touch })
}

const state = () =>
  page.evaluate(() => {
    const root = document.documentElement
    const probe = document.createElement('span')
    probe.style.color = 'var(--accent)'
    document.body.append(probe)
    const accent = getComputedStyle(probe).color
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d')
    const rgb = (color) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 1, 1)
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
    }
    const luminance = (color) => {
      const [r, g, b] = rgb(color).map((byte) => {
        const c = byte / 255
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const contrast = (fg, bg) => {
      const a = luminance(fg)
      const b = luminance(bg)
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    }
    const bg = getComputedStyle(root).backgroundColor
    const selected = document.querySelector(
      '#accent-menu [aria-checked="true"]'
    )
    const selectedStyle = selected && getComputedStyle(selected)
    const result = {
      id: root.dataset.accentPalette,
      accent: rgb(accent),
      contrast: contrast(accent, bg),
      background: bg,
      dark: root.classList.contains('dark'),
      selected: selected?.dataset.palette,
      selectedContrast:
        selectedStyle &&
        contrast(selectedStyle.color, selectedStyle.backgroundColor),
      visible: !document.querySelector('accent-switch').hidden,
      overflow: root.scrollWidth > innerWidth,
      menuHidden: document.getElementById('accent-menu').hidden,
      swatch:
        selected &&
        rgb(selected.querySelector('.accent-switch__swatch').style.background),
    }
    probe.remove()
    return result
  })

const choose = async (id) => {
  await page.click('#accent-switch')
  await page.click(`#accent-menu [data-palette="${id}"]`)
  const actual = await state()
  assert.equal(actual.id, id)
  assert.equal(actual.selected, id)
  assert.equal(actual.menuHidden, true)
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'accent-switch'
  )
  assert.ok(actual.contrast >= 4.5, `${id}: readable accent text`)
  assert.ok(actual.selectedContrast >= 4.5, `${id}: readable selected row`)
  if (!actual.dark) assert.deepEqual(actual.accent, actual.swatch)
  return actual
}

const navigate = async (path) => {
  const href = urlFor(path)
  await page.evaluate((href) => {
    window.__accentSameDocument = true
    const link = document.createElement('a')
    link.id = 'accent-navigation-probe'
    link.href = href
    link.textContent = 'navigation probe'
    // Keep the probe inside the viewport and above the document-wide pointer
    // interceptor used by the installed translation extension.
    link.style.cssText =
      'position:fixed;top:140px;left:24px;z-index:2147483647;width:12px;height:12px;background:#fff'
    document.body.append(link)
  }, href)
  await page.click('#accent-navigation-probe')
  await page.waitForURL(href)
  await page.waitForFunction(
    () => !document.getElementById('accent-navigation-probe')
  )
  assert.equal(await page.evaluate(() => window.__accentSameDocument), true)
}

try {
  await page.cdp('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  await page.evaluate(() => {
    localStorage.removeItem('accent-palette')
    localStorage.setItem('theme', 'light')
  })
  await page.reload()
  assert.deepEqual((await state()).accent, [102, 84, 119])
  const options = await page.evaluate(() =>
    [...document.querySelectorAll('#accent-menu [data-palette]')].map(
      (button) => ({
        id: button.dataset.palette,
        name: button.querySelector('span:nth-child(2)').textContent,
      })
    )
  )
  assert.deepEqual(
    options.map(({ name }) => name),
    ['灰紫', '深紫', '原粉色', '雾蓝', '鼠尾草绿']
  )

  // Keyboard opens at the selected item, moves without applying, confirms and closes.
  await page.focus('#accent-switch')
  await page.press('#accent-switch', 'Enter')
  assert.equal(
    await page.evaluate(() => document.activeElement.dataset.palette),
    options[0].id
  )
  await page.keyboard.press('ArrowDown')
  assert.equal((await state()).id, options[0].id)
  await page.keyboard.press('End')
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Space')
  assert.equal((await state()).id, options.at(-1).id)
  await page.press('#accent-switch', 'ArrowDown')
  await page.keyboard.press('Escape')
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'accent-switch'
  )
  await page.click('#accent-switch')
  await page.click('.blog-profile h2')
  assert.equal((await state()).menuHidden, true)
  await page.click('#accent-switch')
  await page.keyboard.press('Tab')
  assert.equal((await state()).menuHidden, true)

  await page.click('#accent-switch')
  await page.evaluate(() => window.scrollTo(0, 350))
  const readingState = await page.evaluate(() => ({
    scroll: scrollY,
    url: location.href,
  }))
  await page.click(`#accent-menu [data-palette="${options[2].id}"]`)
  assert.deepEqual(
    await page.evaluate(() => ({ scroll: scrollY, url: location.href })),
    readingState,
    'selection preserves the reading position and URL'
  )

  // The palette must neither reload nor reset the light/dark choice or document.
  await page.evaluate(() => {
    window.__accentDocumentToken = 'same-document'
  })
  await choose(options[2].id)
  await choose(options[2].id)
  await page.click('#theme-switch')
  await page.waitForFunction(() =>
    document.documentElement.classList.contains('dark')
  )
  assert.equal((await state()).id, options[2].id)
  await choose(options[1].id)
  assert.equal((await state()).dark, true)
  assert.equal(
    await page.evaluate(() => window.__accentDocumentToken),
    'same-document'
  )

  for (const width of [1440, 390, 320]) {
    await viewport(width, width === 390)
    await page.goto(base)
    await page.click('#accent-switch')
    const bounds = await page.evaluate(() => {
      const menu = document
        .getElementById('accent-menu')
        .getBoundingClientRect()
      const trigger = document
        .getElementById('accent-switch')
        .getBoundingClientRect()
      const theme = document
        .getElementById('theme-switch')
        .getBoundingClientRect()
      window.scrollTo(0, 350)
      return {
        left: menu.left,
        right: menu.right,
        width: innerWidth,
        beforeTheme: trigger.right <= theme.left + 1,
      }
    })
    assert.ok(bounds.left >= 0 && bounds.right <= bounds.width)
    assert.equal(bounds.beforeTheme, true)
    // Wait for scroll delivery and the header's rAF update, not an initially
    // visible header that has not handled the scroll yet.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    )
    assert.equal(
      await page.evaluate(() =>
        document
          .querySelector('[data-site-header]')
          .hasAttribute('data-scroll-hidden')
      ),
      false
    )
    assert.equal((await state()).overflow, false)
    await page.keyboard.press('Escape')
  }
  await viewport(390, true)
  await page.goto(base)
  // Coordinate-based touch does not auto-reveal the header like selector clicks.
  // Return to the top after the preceding scroll/pinning scenarios.
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForFunction(
    () =>
      scrollY === 0 &&
      !document
        .querySelector('[data-site-header]')
        .hasAttribute('data-scroll-hidden')
  )
  const tap = async (selector) => {
    const point = await page.evaluate((selector) => {
      const r = document.querySelector(selector).getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }, selector)
    await page.cdp('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point],
    })
    await page.cdp('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
  }
  await tap('#accent-switch')
  await page.waitForFunction(
    () => !document.getElementById('accent-menu').hidden
  )
  await tap(`#accent-menu [data-palette="${options[3].id}"]`)
  await page.waitForFunction(
    (id) => document.documentElement.dataset.accentPalette === id,
    options[3].id
  )
  assert.equal((await state()).id, options[3].id)
  console.log(
    'Palette keyboard, pointer, touch, theme independence and responsive menu: passed'
  )

  // Visit all shells plus every content-driven interest category and real Markdown.
  await viewport(1440)
  await page.goto(urlFor('/interests/'))
  const interests = await page.evaluate(
    (base) =>
      [...document.querySelectorAll('main a[href*="/interests/"]')].map(
        (a) => `/${a.href.slice(base.length)}`
      ),
    base
  )
  const paths = [
    ...new Set([
      '/',
      '/blogs/',
      '/tags/',
      '/archives/',
      '/interests/',
      ...interests,
      '/projects/',
      '/about/',
      '/friends/',
      '/blogs/image-layout-demo/',
    ]),
  ]
  for (const path of paths) {
    await page.goto(urlFor(path))
    // One real selection checks each new widget's wiring. The shared root
    // attribute is the CSS seam; do not repeat the full menu regression here.
    await choose(options[0].id)
    for (const dark of [false, true]) {
      // Head restores the saved theme on every real navigation. Reapply the
      // requested theme after that initialization instead of racing it.
      await page.evaluate(
        (dark) => localStorage.setItem('theme', dark ? 'dark' : 'light'),
        dark
      )
      await page.reload()
      let previous = null
      for (const { id } of options) {
        let actual
        if (path === '/') actual = await choose(id)
        else {
          await page.evaluate((id) => {
            document.documentElement.dataset.accentPalette = id
          }, id)
          actual = await state()
          assert.equal(actual.id, id)
          assert.ok(actual.contrast >= 4.5, `${path}/${id}: readable accent`)
        }
        assert.equal(
          actual.background,
          dark ? 'rgb(5, 5, 5)' : 'rgb(255, 255, 255)'
        )
        assert.equal(actual.overflow, false, `${path}: no page overflow`)
        if (dark && (id === 'violet' || id === 'purple')) {
          assert.ok(
            actual.accent[2] - actual.accent[1] >= 50,
            `${id}: dark mode keeps a visible purple hue rather than washing out to grey`
          )
        }
        if (dark && id === 'blue') {
          assert.ok(
            actual.accent[2] - actual.accent[0] >= 40,
            'dark mist blue keeps a visible blue hue'
          )
        }
        if (dark && id === 'green') {
          assert.ok(
            actual.accent[1] - Math.max(actual.accent[0], actual.accent[2]) >=
              40,
            'dark sage keeps a visible green hue'
          )
        }
        if (previous) assert.notDeepEqual(actual.accent, previous)
        previous = actual.accent
      }
    }
  }
  // Inspect rendered accent consumers, not the text of stylesheet declarations.
  for (const [path, selector, property, pseudo] of [
    ['/', '.writing-heatmap__cell[data-level="1"]', 'backgroundColor'],
    ['/archives/', '.archive-post__category', 'color'],
    [
      '/blogs/image-layout-demo/',
      '.markdown-content ul > li',
      'backgroundColor',
      '::before',
    ],
    ['/friends/', '.friend-card', 'borderColor'],
    [
      '/blogs/image-layout-demo/',
      '#toc-sidebar a[aria-current="true"]',
      'backgroundColor',
      '::before',
    ],
  ]) {
    await page.goto(urlFor(path))
    await page.waitForFunction(
      (selector) => !!document.querySelector(selector),
      selector
    )
    const exists = await page.evaluate(
      (selector) => !!document.querySelector(selector),
      selector
    )
    assert.equal(exists, true, `${path}: coverage target exists: ${selector}`)
    const read = async () => {
      if (path === '/friends/') await page.hover(`${selector} >> nth=0`)
      return page.evaluate(
        ({ selector, property, pseudo }) =>
          getComputedStyle(document.querySelector(selector), pseudo)[property],
        { selector, property, pseudo }
      )
    }
    await choose(options[0].id)
    const first = await read()
    await choose(options[2].id)
    const second = await read()
    // Category badges are deliberately independent; other accent consumers follow.
    assert.equal(
      first === second,
      path === '/archives/',
      `${path}: correct color ownership`
    )
  }
  await page.goto(urlFor('/blogs/'))
  await page.click('#search-switch')
  await page.fill('#search-input', 'Astro')
  await page.waitForFunction(
    () => !!document.querySelector('.search-result-excerpt mark')
  )
  const highlight = () =>
    page.evaluate(
      () =>
        getComputedStyle(document.querySelector('.search-result-excerpt mark'))
          .backgroundColor
    )
  const originalHighlight = await highlight()
  const input = await page.evaluate(
    () => document.getElementById('search-input').value
  )
  // Native search inputs clear on Escape. Close via the backdrop so that only
  // the palette change, not a separate clear-input action, is under test.
  await page.mouse.click(8, 8, { label: '关闭搜索保留输入' })
  await page.waitForFunction(() =>
    document.getElementById('search-panel').classList.contains('hidden')
  )
  await choose(options[1].id)
  await page.click('#search-switch')
  assert.equal(
    await page.evaluate(() => document.getElementById('search-input').value),
    input
  )
  assert.notEqual(
    await highlight(),
    originalHighlight,
    'real search highlights follow the palette without resetting the query'
  )
  await page.keyboard.press('Escape')
  console.log(
    `Palette coverage: ${paths.length} routes × 2 themes × ${options.length} presets: passed`
  )

  await choose(options[2].id)
  const paintHook = await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `requestAnimationFrame(function capture() {
      if (!document.body) return requestAnimationFrame(capture);
      window.__accentFirstFrame = document.documentElement.dataset.accentPalette;
    });`,
  })
  try {
    await page.reload()
    await page.waitForFunction(() => window.__accentFirstFrame !== undefined)
    assert.equal(
      await page.evaluate(() => window.__accentFirstFrame),
      options[2].id,
      'the first rendered frame restores the saved palette'
    )
  } finally {
    await page.cdp('Page.removeScriptToEvaluateOnNewDocument', {
      identifier: paintHook.identifier,
    })
  }
  assert.equal((await state()).id, options[2].id)
  for (const path of ['/tags/', '/friends/', '/about/', '/']) {
    await navigate(path)
    assert.equal((await state()).id, options[2].id)
  }
  await page.evaluate(() => localStorage.setItem('accent-palette', '__proto__'))
  await page.reload()
  assert.equal((await state()).id, options[0].id)

  for (const mode of ['read', 'write']) {
    await page.evaluate(() => localStorage.removeItem('accent-palette'))
    const hook = await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__accentErrors=[];
        window.addEventListener('error', e => window.__accentErrors.push(e.message));
        window.addEventListener('unhandledrejection', e => window.__accentErrors.push(String(e.reason)));
        const method='${mode === 'read' ? 'getItem' : 'setItem'}';
        const original=Storage.prototype[method];
        Storage.prototype[method]=function(key,...args){
          if(key==='accent-palette') throw new DOMException('Accent storage disabled','SecurityError');
          return Reflect.apply(original,this,[key,...args]);
        };`,
    })
    try {
      await page.reload()
      assert.equal((await state()).id, options[0].id)
      await choose(options[3].id)
      assert.deepEqual(await page.evaluate(() => window.__accentErrors), [])
      await page.reload()
      assert.equal((await state()).id, options[0].id)
    } finally {
      await page.cdp('Page.removeScriptToEvaluateOnNewDocument', {
        identifier: hook.identifier,
      })
      await page.reload()
    }
  }
  await page.cdp('Emulation.setScriptExecutionDisabled', { value: true })
  try {
    await page.reload()
    const actual = await state()
    assert.equal(actual.visible, false)
    assert.deepEqual(actual.accent, [102, 84, 119])
  } finally {
    await page.cdp('Emulation.setScriptExecutionDisabled', { value: false })
    await page.reload()
  }
  console.log(
    'Palette refresh, ClientRouter, malformed preference, storage denial and no-JS fallback: passed'
  )
} finally {
  await page.cdp('Emulation.setScriptExecutionDisabled', { value: false })
  await page.goto(base)
  await page.evaluate((saved) => {
    for (const [key, value] of [
      ['accent-palette', saved.accent],
      ['theme', saved.theme],
    ]) {
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    }
  }, saved)
  await page.cdp('Emulation.setEmulatedMedia', { features: [] })
  await page.cdp('Emulation.setTouchEmulationEnabled', { enabled: false })
  await page.cdp('Emulation.clearDeviceMetricsOverride')
}
