import assert from 'node:assert/strict'
import test from 'node:test'
import {
  drawingFit,
  drawingTransform,
  MAX_DRAWING_ZOOM,
  MIN_DRAWING_ZOOM,
  panDrawing,
  zoomDrawing,
} from '../src/utils/excalidraw-viewport.js'

const drawing = { width: 900, height: 500 }
const frame = { width: 660, height: 371.25 }
const initial = { x: 450, y: 250, zoom: 1 }
const fit = drawingFit(drawing, frame)
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-8)
const project = (point, view, viewport = frame) => {
  const t = drawingTransform(view, viewport, drawingFit(drawing, viewport))
  return { x: point.x * t.scale + t.x, y: point.y * t.scale + t.y }
}

test('fit shows the complete scene without distortion, including tall diagrams', () => {
  for (const size of [drawing, { width: 400, height: 1600 }]) {
    const scale = drawingFit(size, frame)
    assert.ok(size.width * scale <= frame.width * 0.9 + 1e-8)
    assert.ok(size.height * scale <= frame.height * 0.9 + 1e-8)
    assert.ok(scale > 0)
  }
})

test('repeated zoom preserves the point at the current viewport center', () => {
  let view = initial
  for (const factor of [1.2, 1.2, 1 / 1.2, 4, 1 / 4]) {
    view = zoomDrawing(view, view.zoom * factor, fit)
    const screen = project(initial, view)
    close(screen.x, frame.width / 2)
    close(screen.y, frame.height / 2)
  }
})

test('dragging changes the zoom center; subsequent zoom never snaps to the initial center', () => {
  const zoomed = zoomDrawing(initial, 2, fit)
  const panned = panDrawing(zoomed, 80, -35, fit)
  const originalOnScreen = project(initial, panned)
  close(originalOnScreen.x, frame.width / 2 + 80)
  close(originalOnScreen.y, frame.height / 2 - 35)
  assert.notEqual(panned.x, initial.x)
  const afterZoom = zoomDrawing(panned, panned.zoom * 1.2, fit)
  const newCenter = project(panned, afterZoom)
  close(newCenter.x, frame.width / 2)
  close(newCenter.y, frame.height / 2)
  assert.notEqual(project(initial, afterZoom).x, frame.width / 2)
})

test('expanded and resized frames retain the chosen scene center and relative magnification', () => {
  const view = panDrawing(zoomDrawing(initial, 3, fit), -90, 20, fit)
  for (const viewport of [
    { width: 358, height: 201.375 },
    { width: 1200, height: 720 },
  ]) {
    const screen = project(view, view, viewport)
    close(screen.x, viewport.width / 2)
    close(screen.y, viewport.height / 2)
    close(
      drawingTransform(view, viewport, drawingFit(drawing, viewport)).scale /
        drawingFit(drawing, viewport),
      3
    )
  }
})

test('absolute limits stay at 5% and 1600% across content and frame sizes', () => {
  for (const currentFit of [0.08, 0.85, 2.5]) {
    for (const [zoom, expected] of [
      [0, 0.05],
      [1e6, 16],
    ]) {
      const view = zoomDrawing(initial, zoom, currentFit)
      const t = drawingTransform(view, frame, currentFit)
      close(t.scale, expected)
      close(initial.x * t.scale + t.x, frame.width / 2)
      close(initial.y * t.scale + t.y, frame.height / 2)
      const inward = zoomDrawing(
        view,
        view.zoom * (zoom === 0 ? 1.2 : 1 / 1.2),
        currentFit
      )
      assert.ok(inward.zoom > view.zoom || inward.zoom < view.zoom)
    }
  }
  assert.equal(MIN_DRAWING_ZOOM, 0.05)
  assert.equal(MAX_DRAWING_ZOOM, 16)
})

test('fit and resizing respect absolute limits without moving the chosen center', () => {
  assert.equal(drawingFit({ width: 1e6, height: 1e6 }, frame), 0.05)
  assert.equal(drawingFit({ width: 1, height: 1 }, frame), 16)
  const view = { x: 260, y: 180, zoom: 20 }
  const resized = zoomDrawing(view, view.zoom, 2)
  const t = drawingTransform(resized, frame, 2)
  close(t.scale, 16)
  close(view.x * t.scale + t.x, frame.width / 2)
  close(view.y * t.scale + t.y, frame.height / 2)
})
