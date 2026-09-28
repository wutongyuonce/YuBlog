import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

import { placeSlidingIndicator } from '../src/utils/sliding-indicator.js'

const component = readFileSync(
  new URL('../src/components/nav/NavBar.astro', import.meta.url),
  'utf8'
)
const clientScript = component.match(/<script>([\s\S]*?)<\/script>/)?.[1]
assert.ok(clientScript, 'NavBar must have a client script')
const javascript = ts.transpileModule(
  clientScript.replace(
    /^\s*import \{ placeSlidingIndicator \} from '[^']+'\s*$/m,
    ''
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }
).outputText

function createNav() {
  class Anchor {
    constructor(path, left, brand = false) {
      this.href = `https://example.test${path}`
      this.brand = brand
      this.offsetLeft = left
      this.offsetWidth = 54
      this.isConnected = true
      this.attributes = new Map()
    }
    setAttribute(name, value) {
      this.attributes.set(name, value)
    }
    removeAttribute(name) {
      this.attributes.delete(name)
    }
    getAttribute(name) {
      return this.attributes.get(name) ?? null
    }
    matches(selector) {
      return selector === 'a.nav-bar__brand' && this.brand
    }
  }
  const home = new Anchor('/', 2)
  const brand = new Anchor('/', 0, true)
  const about = new Anchor('/about/', 220)
  const friends = new Anchor('/friends/', 274)
  const links = [home, about, friends]
  const indicator = {
    style: {},
    dataset: {},
    getBoundingClientRect() {
      return {}
    },
  }
  const nav = {
    dataset: {},
    contains: (link) => links.includes(link),
    querySelector: () => indicator,
    querySelectorAll: () => links,
  }
  let resolveFonts
  const document = new EventTarget()
  document.documentElement = { dataset: {} }
  document.fonts = { ready: new Promise((resolve) => (resolveFonts = resolve)) }
  document.querySelector = (selector) =>
    selector === '.nav-bar__pages' ? nav : brand
  const window = new EventTarget()
  const location = { pathname: '/' }
  vm.runInNewContext(javascript, {
    document,
    window,
    location,
    URL,
    HTMLAnchorElement: Anchor,
    queueMicrotask,
    placeSlidingIndicator,
  })
  const prepare = (sourceElement, signal = new AbortController().signal) => {
    const event = new Event('astro:before-preparation', { cancelable: true })
    Object.assign(event, { sourceElement, signal })
    document.dispatchEvent(event)
    return event
  }
  return {
    home,
    brand,
    about,
    friends,
    document,
    window,
    location,
    indicator,
    resolveFonts,
    prepare,
  }
}

test('intercepted navigation previews the target before the URL changes', async () => {
  const nav = createNav()
  nav.prepare(nav.about)
  assert.equal(nav.location.pathname, '/')
  assert.equal(nav.indicator.style.transform, 'translateX(220px)')
  // The pill leads, so the label colors must follow the pill; the ARIA state must not.
  assert.equal(nav.about.getAttribute('data-nav-current'), '')
  assert.equal(nav.home.getAttribute('data-nav-current'), null)
  assert.equal(nav.home.getAttribute('aria-current'), 'page')
  assert.equal(nav.about.getAttribute('aria-current'), null)

  nav.resolveFonts()
  await Promise.resolve()
  nav.window.dispatchEvent(new Event('resize'))
  assert.equal(nav.indicator.style.transform, 'translateX(220px)')
  assert.equal(nav.about.getAttribute('data-nav-current'), '')

  nav.location.pathname = '/about/'
  nav.document.dispatchEvent(new Event('astro:page-load'))
  assert.equal(nav.about.getAttribute('aria-current'), 'page')
  assert.equal(nav.home.getAttribute('aria-current'), null)
  assert.equal(nav.about.getAttribute('data-nav-current'), '')
  assert.equal(nav.home.getAttribute('data-nav-current'), null)
})

test('a load that is not this navigation landing keeps the preview', async () => {
  const nav = createNav()
  nav.prepare(nav.about)

  // astro:page-load also fires from window load and from an earlier
  // navigation's completion, while the URL is still the page being left.
  nav.document.dispatchEvent(new Event('astro:page-load'))
  assert.equal(nav.location.pathname, '/')
  assert.equal(nav.indicator.style.transform, 'translateX(220px)')
  assert.equal(nav.about.getAttribute('data-nav-current'), '')
  assert.equal(nav.home.getAttribute('aria-current'), 'page')

  nav.location.pathname = '/about/'
  nav.document.dispatchEvent(new Event('astro:page-load'))
  assert.equal(nav.about.getAttribute('aria-current'), 'page')
})

test('aborted and prevented navigations restore the confirmed page', async () => {
  const nav = createNav()
  const controller = new AbortController()
  nav.prepare(nav.about, controller.signal)
  controller.abort()
  assert.equal(nav.indicator.style.transform, 'translateX(2px)')

  const prevented = nav.prepare(nav.about)
  prevented.preventDefault()
  await Promise.resolve()
  assert.equal(nav.indicator.style.transform, 'translateX(2px)')
  assert.equal(nav.home.getAttribute('aria-current'), 'page')

  const alreadyAborted = new AbortController()
  alreadyAborted.abort()
  nav.prepare(nav.about, alreadyAborted.signal)
  await Promise.resolve()
  assert.equal(nav.indicator.style.transform, 'translateX(2px)')
})

test('a newer navigation wins and page-load reconciles history navigation', () => {
  const nav = createNav()
  const first = new AbortController()
  nav.prepare(nav.about, first.signal)
  first.abort()
  nav.prepare(nav.friends)
  assert.equal(nav.indicator.style.transform, 'translateX(274px)')
  nav.location.pathname = '/friends/'
  nav.document.dispatchEvent(new Event('astro:page-load'))
  assert.equal(nav.friends.getAttribute('aria-current'), 'page')
  nav.location.pathname = '/'
  nav.document.dispatchEvent(new Event('astro:page-load'))
  assert.equal(nav.indicator.style.transform, 'translateX(2px)')
  assert.equal(nav.home.getAttribute('aria-current'), 'page')
})

test('the brand link previews Home while keeping the old aria-current', () => {
  const nav = createNav()
  nav.location.pathname = '/about/'
  nav.document.dispatchEvent(new Event('astro:page-load'))
  nav.prepare(nav.brand)
  assert.equal(nav.indicator.style.transform, 'translateX(2px)')
  assert.equal(nav.about.getAttribute('aria-current'), 'page')
  nav.location.pathname = '/'
  nav.document.dispatchEvent(new Event('astro:page-load'))
  assert.equal(nav.home.getAttribute('aria-current'), 'page')
})

test('only top-bar links to another page get optimistic feedback', () => {
  const nav = createNav()
  nav.prepare(nav.home)
  nav.prepare(new nav.home.constructor('/outside/', 400))
  assert.equal(nav.indicator.style.transform, 'translateX(2px)')
  assert.equal(nav.home.getAttribute('aria-current'), 'page')
})
