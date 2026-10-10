import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canMarquee,
  createMarqueeController,
} from '../src/utils/card-rail-marquee.js'

function layout(parent) {
  const gap = 16
  let left = 0
  for (const card of parent.children) {
    card.offsetLeft = left
    card.parent = parent
    left += card.offsetWidth + gap
  }
}

function createCard(width) {
  const attrs = new Map()
  const focusable = [{ tabIndex: 0 }]
  return {
    offsetWidth: width,
    offsetLeft: 0,
    classList: { contains: (name) => name === 'media-card' },
    setAttribute(name, value) {
      attrs.set(name, String(value))
    },
    hasAttribute(name) {
      return attrs.has(name)
    },
    remove() {
      const index = this.parent?.children.indexOf(this) ?? -1
      if (index >= 0) this.parent.children.splice(index, 1)
      if (this.parent) layout(this.parent)
    },
    cloneNode() {
      const copy = createCard(width)
      copy.querySelectorAll = () => focusable
      return copy
    },
    querySelectorAll() {
      return []
    },
  }
}

function matches(node, selector) {
  if (selector.includes('not([data-marquee-clone])'))
    return !node.hasAttribute('data-marquee-clone')
  if (selector.includes('data-marquee-clone'))
    return node.hasAttribute('data-marquee-clone')
  return true
}

function createRail(widths, clientWidth) {
  const props = new Map()
  const track = {
    className: 'media-cards__track',
    children: [],
    style: {
      setProperty(name, value) {
        props.set(name, value)
      },
      removeProperty(name) {
        props.delete(name)
      },
    },
    append(child) {
      this.children.push(child)
      child.parent = this
      layout(this)
    },
    querySelectorAll(selector) {
      return this.children.filter((child) => matches(child, selector))
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null
    },
  }
  const rail = {
    clientWidth,
    dataset: {},
    isConnected: true,
    querySelector(selector) {
      return selector.includes('media-cards__track') ? track : null
    },
    distance: () => props.get('--marquee-distance'),
    track,
  }
  for (const width of widths) track.append(createCard(width))
  return rail
}

test('auto scroll starts only when the authored row is wider than the rail', () => {
  const fitting = createRail([100, 100], 400)
  const overflowing = createRail([120, 120, 120], 200)
  const single = createRail([300], 100)
  assert.equal(canMarquee(fitting), false)
  assert.equal(canMarquee(overflowing), true)
  assert.equal(
    canMarquee(single),
    false,
    'one card cannot loop without sitting beside itself'
  )

  createMarqueeController({
    query: () => [fitting],
    reducedMotion: () => false,
  }).sync()
  assert.equal(fitting.dataset.marquee, undefined)
  assert.equal(fitting.track.children.length, 2)

  createMarqueeController({
    query: () => [overflowing],
    reducedMotion: () => true,
  }).sync()
  assert.equal(overflowing.dataset.marquee, undefined)
  assert.equal(overflowing.track.children.length, 3)
})

test('an overflowing rail duplicates inside the plugin track and records the seam', () => {
  const rail = createRail([120, 120, 120], 200)
  const controller = createMarqueeController({
    query: () => [rail],
    reducedMotion: () => false,
  })
  controller.sync()
  assert.equal(rail.dataset.marquee, 'on')
  assert.equal(
    rail.track.children.length,
    6,
    'one visual copy, without moving cards out of the track'
  )
  assert.equal(rail.track.children[3].hasAttribute('aria-hidden'), true)
  assert.equal(rail.track.children[3].querySelectorAll()[0].tabIndex, -1)
  const loop =
    rail.track.children[3].offsetLeft - rail.track.children[0].offsetLeft
  assert.equal(rail.distance(), `${loop}px`)
  assert.ok(loop > rail.clientWidth)

  controller.stopAll()
  assert.equal(rail.track.children.length, 3)
  assert.equal(rail.dataset.marquee, undefined)
  assert.equal(rail.distance(), undefined)
})
