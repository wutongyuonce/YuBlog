/** The camera center is in SVG coordinates; zoom is relative to fit. */
// Absolute scene scale, matching the reference viewer (5%–1600%).
export const MIN_DRAWING_ZOOM = 0.05
export const MAX_DRAWING_ZOOM = 16

const clampScale = (scale) =>
  Math.max(MIN_DRAWING_ZOOM, Math.min(MAX_DRAWING_ZOOM, scale))

/** @param {{width: number, height: number}} drawing @param {{width: number, height: number}} frame */
export function drawingFit(drawing, frame) {
  return clampScale(
    Math.min(frame.width / drawing.width, frame.height / drawing.height) * 0.9
  )
}

/** @param {{x: number, y: number, zoom: number}} view @param {number} zoom @param {number} fit */
export function zoomDrawing(view, zoom, fit) {
  return {
    ...view,
    zoom: clampScale(zoom * fit) / fit,
  }
}

/** @param {{x: number, y: number, zoom: number}} view @param {number} dx @param {number} dy @param {number} fit */
export function panDrawing(view, dx, dy, fit) {
  return {
    ...view,
    x: view.x - dx / (fit * view.zoom),
    y: view.y - dy / (fit * view.zoom),
  }
}

/** @param {{x: number, y: number, zoom: number}} view @param {{width: number, height: number}} frame @param {number} fit */
export function drawingTransform(view, frame, fit) {
  const scale = fit * view.zoom
  return {
    scale,
    x: frame.width / 2 - view.x * scale,
    y: frame.height / 2 - view.y * scale,
  }
}
