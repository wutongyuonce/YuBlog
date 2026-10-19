/**
 * Gallery discovery for the body-image lightbox.
 *
 * Scope: one `.markdown-content` root (blog body, interests MD, homepage
 * 「近期书影游」等凡 Markdown 渲染进该根的内容).
 *
 * Included once each: every `.image-view` that already participates in zoom —
 * ordinary images, gallery/figure, and `:::card` covers (竖／方陈列架与带外链
 * 的影游卡封面，含首页 MD 陈列架的**源**卡片).
 *
 * Excluded:
 * - `[data-marquee-clone]` — JS 为无缝横滑复制的 DOM 副本（首页专辑陈列架等同理）；
 *   源卡封面仍进相册，每张逻辑图只一次。点副本用 src 对齐源张。
 * - `.excalidraw-embed`（及其内部预览／导出图）— **始终**不进照片 lightbox：画布是
 *   交互嵌入不是照片，有独立展开查看器；即使用 img 呈现也不并入相册。
 * - 无 `.image-view` 的节点（如 `:::blog-link` 头像）— 本就不参与 zoom。
 */

/** Prefer inert full-size template src; fall back to the visible img. */
export function imageViewSourceKey(view) {
  const template = view.querySelector('template')
  const full =
    template && 'content' in template
      ? template.content.querySelector('img')
      : null
  const image = full ?? view.querySelector('img')
  if (!image) return ''
  return image.getAttribute('src') || image.src || ''
}

export function isLightboxGalleryView(view) {
  return (
    !view.closest('[data-marquee-clone]') &&
    !view.closest('.excalidraw-embed') &&
    !!view.querySelector('img')
  )
}

/** Same MD root; originals only (marquee sources in, clones out). */
export function lightboxViewsInArticle(from) {
  const root = from.closest('.markdown-content') ?? document
  return [...root.querySelectorAll('.image-view')].filter(isLightboxGalleryView)
}

/**
 * Map a clicked view (including a marquee clone) onto the deduped slide list.
 * @returns {number} index in slides, or -1
 */
export function resolveLightboxSlideIndex(slides, fromView) {
  const direct = slides.indexOf(fromView)
  if (direct >= 0) return direct
  const key = imageViewSourceKey(fromView)
  if (!key) return -1
  return slides.findIndex((view) => imageViewSourceKey(view) === key)
}

export function clampSlideIndex(index, total) {
  if (total <= 0) return 0
  return Math.max(0, Math.min(total - 1, index))
}
