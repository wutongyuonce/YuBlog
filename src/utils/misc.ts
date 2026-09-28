/**
 * 正文列宽（CSS 像素）。
 *
 * 镜像 `src/styles/main.css` 里的 `--blog-article-width: 70ch`：在 ≥1280px
 * 视口下实测约 706px。组件需要具体像素时才用它，不要另写一个数字。
 */
export const ARTICLE_COLUMN_WIDTH = 706

/**
 * Locks the scroll position of the document.
 */
export function lockScroll() {
  const bodyEl = document.body

  const scrollbarWidth = window.innerWidth - bodyEl.clientWidth
  const hasRose = document.getElementById('bg-rose')
  if (scrollbarWidth > 0 && !hasRose)
    bodyEl.style.paddingRight = `${scrollbarWidth}px`
  bodyEl.style.overflow = 'hidden'
}

/**
 * Unlocks the scroll position of the document.
 */
export function unlockScroll() {
  const bodyEl = document.body

  bodyEl.style.removeProperty('overflow')
  bodyEl.style.removeProperty('padding-right')
}

/**
 * Controls the fading animation of an element,
 * showing or hiding it based on visibility.
 */
export function toggleFadeEffect(
  elementId: string,
  visible: boolean,
  hiddenClass: string
) {
  const element = document.getElementById(elementId)
  if (!element) return

  if (visible) {
    element.classList.remove(hiddenClass)
    if (elementId === 'backdrop') lockScroll()
    if (window.matchMedia('(prefers-reduced-motion)').matches) return
    element.classList.add('fade-in')
  } else {
    if (window.matchMedia('(prefers-reduced-motion)').matches) {
      element.classList.add(hiddenClass)
      if (elementId === 'backdrop') unlockScroll()
      return
    }
    element.classList.add('fade-out')
    element.addEventListener(
      'animationend',
      () => {
        element.classList.remove('fade-in', 'fade-out')
        element.classList.add(hiddenClass)
        if (elementId === 'backdrop') unlockScroll()
      },
      { once: true }
    )
  }
}
