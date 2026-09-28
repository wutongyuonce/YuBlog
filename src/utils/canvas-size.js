/**
 * canvas 后备存储的 DPR 上限。
 *
 * 背景动画每帧的成本与后备存储的像素数成正比，而 2× 以上的 DPR 在屏幕上
 * 看不出差别，只会让每帧多填几倍的像素。Dot / Snow 两个场景共用这一条上限。
 */
export const MAX_CANVAS_DPR = 2

/**
 * 按视口尺寸设置 canvas 后备存储，并让 ctx 之后用 CSS 像素坐标作画。
 *
 * 参数显式传入而不是在内部读 `window`，这样上限和取整规则可以在没有 DOM 的
 * 情况下测（见 `test/canvas-size.test.mjs`）。
 *
 * @param {{ width: number, height: number, style: { width: string, height: string } }} canvas
 * @param {{ setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void }} ctx
 * @param {number} width CSS 像素宽度
 * @param {number} height CSS 像素高度
 * @param {number | undefined} dpr 设备像素比，缺失时按 1 处理
 * @returns {number} 实际使用的缩放比
 */
export function sizeCanvasForViewport(canvas, ctx, width, height, dpr) {
  const scale = Math.min(dpr || 1, MAX_CANVAS_DPR)

  canvas.width = Math.floor(width * scale)
  canvas.height = Math.floor(height * scale)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  ctx.setTransform(scale, 0, 0, scale, 0, 0)

  return scale
}
