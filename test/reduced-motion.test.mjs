import assert from 'node:assert/strict'
import test from 'node:test'

import { createReducedMotionGate } from '../src/utils/reduced-motion.js'

/** 可注入的假 MediaQueryList：记录订阅，并允许模拟系统设置变化。 */
const createQuery = (matches) => {
  const listeners = new Set()
  return {
    matches,
    listeners,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    setMatches(next) {
      this.matches = next
      for (const listener of listeners) listener()
    },
  }
}

const createCalls = () => {
  const calls = { static: 0, animate: 0 }
  return {
    calls,
    handlers: {
      onStatic: () => calls.static++,
      onAnimate: () => calls.animate++,
    },
  }
}

test('applies the static branch immediately when reduced motion is on', () => {
  const query = createQuery(true)
  const { calls, handlers } = createCalls()

  createReducedMotionGate({ ...handlers, query }).start()

  assert.deepEqual(calls, { static: 1, animate: 0 })
})

test('applies the animate branch immediately when reduced motion is off', () => {
  const query = createQuery(false)
  const { calls, handlers } = createCalls()

  createReducedMotionGate({ ...handlers, query }).start()

  assert.deepEqual(calls, { static: 0, animate: 1 })
})

test('switches branch when the system setting changes', () => {
  const query = createQuery(false)
  const { calls, handlers } = createCalls()
  const gate = createReducedMotionGate({ ...handlers, query })

  gate.start()
  query.setMatches(true)
  query.setMatches(false)

  assert.deepEqual(calls, { static: 1, animate: 2 })
})

test('stop() unsubscribes so later changes are ignored', () => {
  const query = createQuery(false)
  const { calls, handlers } = createCalls()
  const gate = createReducedMotionGate({ ...handlers, query })

  gate.start()
  gate.stop()
  query.setMatches(true)

  assert.equal(query.listeners.size, 0)
  assert.deepEqual(calls, { static: 0, animate: 1 })
})
