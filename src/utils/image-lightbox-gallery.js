/** Same-article views that already open today’s lightbox (no new discovery path). */
export function lightboxViewsInArticle(from) {
  const root = from.closest('.markdown-content') ?? document
  return [...root.querySelectorAll('.image-view')].filter(
    (view) =>
      !view.closest('[data-marquee-clone]') &&
      !view.closest('.excalidraw-embed') &&
      !!view.querySelector('img')
  )
}

export function clampSlideIndex(index, total) {
  if (total <= 0) return 0
  return Math.max(0, Math.min(total - 1, index))
}
