import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(
  new URL('../src/components/widgets/CardScrollbars.astro', import.meta.url),
  'utf8'
).match(/<script>([\s\S]*?)<\/script>/)[1]
const script = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText

test('only the scrolling card text shows a thumb, until its last scroll settles', () => {
  let onScroll
  let options
  const pending = new Map()
  let next = 0
  class Area {
    dataset = {}
    constructor(cardText = true) {
      this.cardText = cardText
    }
    matches(selector) {
      assert.equal(selector, '.media-card__meta, .media-card__review')
      return this.cardText
    }
  }
  vm.runInNewContext(script, {
    HTMLElement: Area,
    document: {
      addEventListener(name, fn, opts) {
        assert.equal(name, 'scroll')
        onScroll = fn
        options = opts
      },
    },
    window: {
      clearTimeout: (id) => pending.delete(id),
      setTimeout(fn, delay) {
        assert.ok(delay > 0)
        pending.set(++next, fn)
        return next
      },
    },
  })
  assert.equal(options.capture, true, 'element scroll events do not bubble')
  assert.equal(options.passive, true, 'native scrolling must not be blocked')
  const meta = new Area()
  const review = new Area()
  const rail = new Area(false)
  onScroll({ target: rail })
  onScroll({ target: {} })
  assert.equal(pending.size, 0, 'the bottom horizontal scrollbar is unaffected')
  assert.equal('scrolling' in meta.dataset, false)
  onScroll({ target: meta })
  onScroll({ target: review })
  onScroll({ target: meta })
  assert.equal(
    pending.size,
    2,
    'repeated scroll replaces only its own hide timer'
  )
  assert.equal('scrolling' in meta.dataset, true)
  assert.equal('scrolling' in review.dataset, true)
  for (const fn of pending.values()) fn()
  assert.equal('scrolling' in meta.dataset, false)
  assert.equal('scrolling' in review.dataset, false)
  const afterNavigation = new Area()
  onScroll({ target: afterNavigation })
  assert.equal(
    'scrolling' in afterNavigation.dataset,
    true,
    'new page content uses the same listener'
  )
})
