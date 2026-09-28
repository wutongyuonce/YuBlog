import assert from 'node:assert/strict'
import test from 'node:test'

import { placeSlidingIndicator } from '../src/utils/sliding-indicator.js'

/** 记录 style 赋值与回流调用次数的假元素。 */
const createStub = ({ width = 0, left = 0, ready = false } = {}) => {
  const sets = []
  const element = {
    style: new Proxy(
      {},
      {
        set(target, prop, value) {
          sets.push([prop, value])
          target[prop] = value
          return true
        },
      }
    ),
    dataset: ready ? { ready: 'true' } : {},
    offsetWidth: width,
    offsetLeft: left,
    reflows: 0,
    getBoundingClientRect() {
      this.reflows++
      return {}
    },
  }
  return { element, sets }
}

const transitions = (sets) => sets.filter(([prop]) => prop === 'transition')

test('first placement drops the transition and sets width + offset', () => {
  const { element: indicator, sets } = createStub()
  const { element: target } = createStub({ width: 88, left: 240 })

  assert.equal(placeSlidingIndicator({ indicator, target }), true)

  assert.deepEqual(indicator.style.width, '88px')
  assert.deepEqual(indicator.style.transform, 'translateX(240px)')
  assert.deepEqual(transitions(sets), [
    ['transition', 'none'],
    ['transition', ''],
  ])
  assert.equal(indicator.reflows, 1)
  assert.equal(indicator.dataset.ready, 'true')
})

test('later placement keeps the transition so the pill animates', () => {
  const { element: indicator, sets } = createStub({ ready: true })
  const { element: target } = createStub({ width: 60, left: 12 })

  placeSlidingIndicator({ indicator, target })

  assert.deepEqual(transitions(sets), [])
  assert.equal(indicator.reflows, 0)
  assert.equal(indicator.style.width, '60px')
})

test('animate=false always drops the transition, even when already placed', () => {
  const { element: indicator, sets } = createStub({ ready: true })
  const { element: target } = createStub({ width: 60, left: 12 })

  placeSlidingIndicator({ animate: false, indicator, target })

  assert.deepEqual(transitions(sets), [
    ['transition', 'none'],
    ['transition', ''],
  ])
})

test('no target collapses the pill to zero width', () => {
  const { element: indicator, sets } = createStub({ width: 88, left: 240 })

  assert.equal(placeSlidingIndicator({ indicator, target: null }), false)

  assert.equal(indicator.style.width, '0px')
  assert.deepEqual(transitions(sets), [
    ['transition', 'none'],
    ['transition', ''],
  ])
  assert.equal(indicator.dataset.ready, 'true')
})

test('missing indicator is a no-op', () => {
  const { element: target } = createStub({ width: 88, left: 240 })

  assert.equal(placeSlidingIndicator({ indicator: null, target }), false)
})
