import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_CANVAS_DPR,
  sizeCanvasForViewport,
} from '../src/utils/canvas-size.js'

const createStub = () => {
  const transforms = []
  return {
    canvas: { width: 0, height: 0, style: {} },
    ctx: { setTransform: (...args) => transforms.push(args) },
    transforms,
  }
}

test('canvas backing store is capped at 2x DPR', () => {
  const { canvas, ctx } = createStub()

  assert.equal(sizeCanvasForViewport(canvas, ctx, 1440, 900, 3), 2)
  assert.equal(canvas.width, 2880)
  assert.equal(canvas.height, 1800)

  // 上限是共享事实：两个背景场景的每帧成本都按这个假设算。
  assert.equal(MAX_CANVAS_DPR, 2)
})

test('drawing coordinates stay in CSS pixels', () => {
  const { canvas, ctx, transforms } = createStub()

  sizeCanvasForViewport(canvas, ctx, 800, 600, 2)

  assert.equal(canvas.style.width, '800px')
  assert.equal(canvas.style.height, '600px')
  assert.deepEqual(transforms, [[2, 0, 0, 2, 0, 0]])
})

test('missing DPR falls back to 1 and fractional DPR is kept below the cap', () => {
  const missing = createStub()
  sizeCanvasForViewport(missing.canvas, missing.ctx, 100, 50, undefined)
  assert.equal(missing.canvas.width, 100)
  assert.equal(missing.canvas.height, 50)

  const fractional = createStub()
  sizeCanvasForViewport(fractional.canvas, fractional.ctx, 100, 50, 1.5)
  assert.equal(fractional.canvas.width, 150)
  assert.equal(fractional.canvas.height, 75)
})

test('fractional CSS pixel sizes floor the backing store', () => {
  const { canvas, ctx } = createStub()

  sizeCanvasForViewport(canvas, ctx, 390.4, 780.6, 2)

  assert.equal(canvas.width, 780)
  assert.equal(canvas.height, 1561)
  assert.equal(canvas.style.width, '390.4px')
})
