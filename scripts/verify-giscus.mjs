/* global taskSpace */
import assert from 'node:assert/strict'

const task = await taskSpace(Number('__TASK_SPACE_ID__'))
const page = task.page('p1')
const base = '__BASE_URL__'

await page.cdp('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
})
await page.goto(new URL('interests/device/', base).href)
await page.waitForSelector('giscus-comments')
assert.equal(
  await page.evaluate(() => document.querySelector('giscus-widget') === null),
  true,
  'A long page must not load comments at its top'
)
assert.equal(
  await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .some((entry) => entry.name.startsWith('https://giscus.app/'))
  ),
  false,
  'Giscus requests wait until the reader approaches comments'
)

const reveal = async () => {
  await page.evaluate(() =>
    document.querySelector('giscus-comments').scrollIntoView()
  )
  await page.waitForFunction(() => {
    const frame = document.querySelector('giscus-widget')?.iframeRef
    return frame && !frame.classList.contains('loading')
  })
}
await reveal()
const first = await page.evaluate(() => {
  const widget = document.querySelector('giscus-widget')
  window.__giscusFrame = widget.iframeRef
  const url = new URL(widget.iframeRef.src)
  return {
    term: url.searchParams.get('term'),
    backlink: url.searchParams.get('backLink'),
    canonical: document.querySelector('link[rel="canonical"]').href,
    path: new URL(document.querySelector('link[rel="canonical"]').href)
      .pathname,
  }
})
assert.equal(first.term, first.path)
assert.equal(first.backlink, first.canonical)
assert.notEqual(new URL(first.backlink).origin, new URL(base).origin)

// Exercise the site's actual switch; theme updates must preserve the iframe.
await page.press('#theme-switch', 'Space')
await page.waitForFunction(() => {
  const dark = document.documentElement.classList.contains('dark')
  return (
    document.querySelector('giscus-widget')?.theme ===
    (dark ? 'noborder_dark' : 'noborder_light')
  )
})
assert.equal(
  await page.evaluate(
    () =>
      document.querySelector('giscus-widget').iframeRef === window.__giscusFrame
  ),
  true
)

for (const width of [390, 320]) {
  await page.cdp('Emulation.setDeviceMetricsOverride', {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await reveal()
  assert.equal(
    await page.evaluate(() => {
      const frame = document
        .querySelector('giscus-widget')
        .iframeRef.getBoundingClientRect()
      return (
        frame.left >= 0 &&
        frame.right <= innerWidth &&
        document.documentElement.scrollWidth <= innerWidth
      )
    }),
    true,
    `${width}px: comments fit within the reading column`
  )
}

// Use real ClientRouter navigation, including an intervening page without comments.
await page.evaluate(() => {
  window.__giscusNavigation = true
})
await page.press('a[data-nav-link][href$="/interests/"]', 'Enter')
await page.waitForFunction(() => !document.querySelector('giscus-comments'))
assert.equal(await page.evaluate(() => window.__giscusNavigation), true)
const paths = await page.evaluate(() =>
  [...document.querySelectorAll('.interests-page__index a')].map((link) =>
    link.getAttribute('href')
  )
)
for (const path of paths) {
  await page.press(`.interests-page__index a[href="${path}"]`, 'Enter')
  await page.waitForURL(new URL(path, base).href)
  await reveal()
  assert.equal(
    await page.evaluate(() => {
      const widgets = document.querySelectorAll('giscus-widget')
      return (
        widgets.length === 1 &&
        new URL(widgets[0].iframeRef.src).searchParams.get('term') ===
          new URL(document.querySelector('link[rel="canonical"]').href).pathname
      )
    }),
    true,
    `${path}: own discussion after client navigation`
  )
  await page.press('a[data-nav-link][href$="/interests/"]', 'Enter')
  await page.waitForFunction(() => !document.querySelector('giscus-comments'))
}
// A synthetic callback exercises the real vendor constructor's URL cleanup.
// Keep the test session in memory so it never replaces the reader's saved login.
const callbackScript = await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    if (new URLSearchParams(location.search).get('giscus') === 'yublog-history-test') {
      let session = null;
      const get = Storage.prototype.getItem;
      const set = Storage.prototype.setItem;
      const remove = Storage.prototype.removeItem;
      Storage.prototype.getItem = function(key) {
        return key === 'giscus-session' ? session : get.call(this, key);
      };
      Storage.prototype.setItem = function(key, value) {
        if (key === 'giscus-session') session = value;
        else set.call(this, key, value);
      };
      Storage.prototype.removeItem = function(key) {
        if (key === 'giscus-session') session = null;
        else remove.call(this, key);
      };
    }
  `,
})
try {
  await page.goto(
    new URL('interests/device/?giscus=yublog-history-test', base).href
  )
  await page.waitForFunction(
    () => !new URLSearchParams(location.search).has('giscus')
  )
  assert.equal(
    await page.evaluate(() => Number.isInteger(history.state?.index)),
    true,
    'OAuth cleanup must preserve Astro history state'
  )
  await page.evaluate(() => {
    window.__callbackNavigation = true
  })
  await page.press('a[data-nav-link][href$="/interests/"]', 'Enter')
  await page.waitForFunction(() => !document.querySelector('giscus-comments'))
  await page.evaluate(() => history.back())
  await page.waitForSelector('giscus-comments')
  assert.equal(
    await page.evaluate(() => window.__callbackNavigation),
    true,
    'Back must restore the callback page through ClientRouter'
  )
} finally {
  await page.cdp('Page.removeScriptToEvaluateOnNewDocument', {
    identifier: callbackScript.identifier,
  })
}
await page.goto(new URL('friends/', base).href)
await reveal()
assert.ok((await page.snapshot()).includes('申请友链与留言'))
// Article comments must share the body column, even though main is full width.
await page.press('a[data-nav-link][href$="/blogs/"]', 'Enter')
await page.waitForSelector('.post-preview h2 a')
const articlePath = await page.evaluate(() =>
  [...document.querySelectorAll('.post-preview h2 a')]
    .find(
      (link) =>
        link.origin === location.origin && link.pathname.includes('/blogs/')
    )
    .getAttribute('href')
)
await page.click('.post-preview h2 a[href="' + articlePath + '"]')
await page.waitForSelector('.post-content')
await reveal()
for (const width of [1440, 390, 320]) {
  await page.cdp('Emulation.setDeviceMetricsOverride', {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  for (let theme = 0; theme < 2; theme++) {
    await page.press('#theme-switch', 'Space')
    await reveal()
    const layout = await page.evaluate(() => {
      const body = document
        .querySelector('.post-content')
        .getBoundingClientRect()
      const comments = document
        .querySelector('.comments')
        .getBoundingClientRect()
      const back = document
        .querySelector('main > footer.prose')
        .getBoundingClientRect()
      const frame = document
        .querySelector('giscus-widget')
        .iframeRef.getBoundingClientRect()
      return {
        aligned:
          Math.abs(body.left - comments.left) < 1 &&
          Math.abs(body.width - comments.width) < 1,
        frameFits: Math.abs(frame.width - comments.width) < 1,
        order: body.bottom <= back.top && back.bottom < comments.top,
        noOverflow: document.documentElement.scrollWidth <= innerWidth,
      }
    })
    assert.deepEqual(
      layout,
      { aligned: true, frameFits: true, order: true, noOverflow: true },
      '' +
        width +
        'px: body → cd .. → comments share the site column in both themes'
    )
  }
}
console.log(
  'Giscus: lazy loading, canonical identity/backlink, theme, mobile, ClientRouter and article column/order checks passed.'
)
