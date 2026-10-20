/** Optimized hero image size; matches the 660px reading column. */
export const ARTICLE_COLUMN_WIDTH = 660

/** Lock the document scroller; an old page's release cannot unlock a new page. */
export function lockScroll() {
  const rootEl = document.documentElement
  const bodyEl = document.body
  const previousOverflow = rootEl.style.overflow
  const previousPadding = bodyEl.style.paddingRight
  const scrollbarWidth = window.innerWidth - rootEl.clientWidth
  const hasStableGutter =
    getComputedStyle(rootEl).scrollbarGutter.includes('stable')
  if (scrollbarWidth > 0 && !hasStableGutter) {
    const padding = parseFloat(getComputedStyle(bodyEl).paddingRight) || 0
    bodyEl.style.paddingRight = `${padding + scrollbarWidth}px`
  }
  rootEl.style.overflow = 'hidden'
  return () => {
    if (document.body === bodyEl) rootEl.style.overflow = previousOverflow
    bodyEl.style.paddingRight = previousPadding
  }
}

// Backdrops are replaced with body on client navigation; bind the release to
// that element so a cancelled exit animation cannot retain the next page's lock.
const backdropScroll = new WeakMap<HTMLElement, () => void>()

function unlockScroll(backdrop: HTMLElement) {
  backdropScroll.get(backdrop)?.()
  backdropScroll.delete(backdrop)
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
    if (elementId === 'backdrop' && !backdropScroll.has(element))
      backdropScroll.set(element, lockScroll())
    if (window.matchMedia('(prefers-reduced-motion)').matches) return
    element.classList.add('fade-in')
  } else {
    if (window.matchMedia('(prefers-reduced-motion)').matches) {
      element.classList.add(hiddenClass)
      if (elementId === 'backdrop') unlockScroll(element)
      return
    }
    element.classList.add('fade-out')
    element.addEventListener(
      'animationend',
      () => {
        element.classList.remove('fade-in', 'fade-out')
        element.classList.add(hiddenClass)
        if (elementId === 'backdrop') unlockScroll(element)
      },
      { once: true }
    )
  }
}
