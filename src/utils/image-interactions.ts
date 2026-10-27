import { lockScroll } from './misc'
import {
  clampSlideIndex,
  lightboxViewsInArticle,
  resolveLightboxSlideIndex,
} from './image-lightbox-gallery.js'

const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>'
const PREV_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>'
const NEXT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>'

/** Owns gallery controls, the modal viewer and their page-scoped resources. */
export class ImageInteractions extends HTMLElement {
  private controller?: AbortController
  private dialog?: HTMLDialogElement
  private trigger?: HTMLElement
  private releaseScroll?: () => void
  // Linked-image zoom buttons sit outside the authored link and image view.
  private linkedViews = new Map<HTMLElement, HTMLElement>()
  private slides: HTMLElement[] = []
  private slideIndex = 0
  private indexLabel?: HTMLElement
  private previousButton?: HTMLButtonElement
  private nextButton?: HTMLButtonElement

  connectedCallback() {
    if (this.controller) return
    this.controller = new AbortController()
    const { signal } = this.controller

    const dialog = document.createElement('dialog')
    dialog.className = 'image-lightbox'
    dialog.setAttribute('aria-label', '图片大图')
    dialog.innerHTML = `<div class="image-lightbox__panel">
      <img alt="">
      <p class="image-lightbox__caption"></p>
      <div class="image-lightbox__toolbar" role="group" aria-label="大图相册">
        <span class="image-lightbox__index" aria-live="polite"></span>
        <div class="image-lightbox__arrows">
          <button type="button" class="image-lightbox__prev" aria-label="上一张">${PREV_ICON}</button>
          <button type="button" class="image-lightbox__next" aria-label="下一张">${NEXT_ICON}</button>
        </div>
        <button type="button" class="image-lightbox__close" aria-label="关闭大图">${CLOSE_ICON}</button>
      </div>
    </div>`
    document.body.append(dialog)
    this.dialog = dialog
    this.indexLabel = dialog.querySelector('.image-lightbox__index')!
    this.previousButton = dialog.querySelector('.image-lightbox__prev')!
    this.nextButton = dialog.querySelector('.image-lightbox__next')!

    const close = () => {
      dialog.close()
      this.restore()
    }
    dialog
      .querySelector('.image-lightbox__close')!
      .addEventListener('click', close, { signal })
    dialog.querySelector('img')!.addEventListener('click', close, { signal })
    dialog.addEventListener(
      'click',
      (event) => {
        if (event.target === dialog) close()
      },
      { signal }
    )
    dialog.addEventListener(
      'cancel',
      (event) => {
        event.preventDefault()
        close()
      },
      { signal }
    )
    this.previousButton.addEventListener(
      'click',
      (event) => {
        event.stopPropagation()
        this.go(-1)
      },
      { signal }
    )
    this.nextButton.addEventListener(
      'click',
      (event) => {
        event.stopPropagation()
        this.go(1)
      },
      { signal }
    )

    const openFrom = (trigger: HTMLElement) => {
      const view =
        this.linkedViews.get(trigger) ??
        trigger.closest<HTMLElement>('.image-view')
      if (!view?.querySelector('img')) return
      // Marquee clones are openable (delegation) but must map onto the source slide.
      this.slides = lightboxViewsInArticle(view)
      const index = resolveLightboxSlideIndex(this.slides, view)
      if (index < 0) return
      this.slideIndex = index
      this.showSlide(trigger)
      if (!dialog.open) {
        this.releaseScroll = lockScroll()
        dialog.showModal()
      }
    }
    // Delegation covers marquee clones. Those nodes copy markup, not listeners.
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target
        if (!(target instanceof Element)) return
        const zoom = target.closest<HTMLElement>('.image-view__linked-zoom')
        if (zoom) {
          event.preventDefault()
          event.stopPropagation()
          openFrom(zoom)
          return
        }
        const image = target.closest<HTMLElement>(
          '.markdown-content .image-view img'
        )
        if (!image || image.closest('a') || image.closest('.excalidraw-embed'))
          return
        event.preventDefault()
        event.stopPropagation()
        openFrom(image)
      },
      { signal }
    )
    document.addEventListener(
      'keydown',
      (event) => {
        if (dialog.open) {
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            this.go(-1)
            return
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            this.go(1)
            return
          }
          return
        }
        if (event.key !== 'Enter' && event.key !== ' ') return
        const image = event.target
        if (!(image instanceof HTMLImageElement)) return
        if (!image.matches('.markdown-content .image-view img')) return
        if (image.closest('a') || image.closest('.excalidraw-embed')) return
        event.preventDefault()
        openFrom(image)
      },
      { signal }
    )
    // 脚本注入的图片视图在首次扫描之后才出现，由注入方要求重新接管。
    document.addEventListener('content:added', () => this.bindViews(), {
      signal,
    })

    this.bindViews()

    for (const gallery of document.querySelectorAll<HTMLElement>(
      '.markdown-content .image-gallery--scroll'
    )) {
      this.bindGallery(gallery, signal)
    }
  }

  private triggerFor(view: HTMLElement): HTMLElement | undefined {
    for (const [trigger, linkedView] of this.linkedViews)
      if (linkedView === view) return trigger
    return view.querySelector<HTMLElement>('img') ?? undefined
  }

  private showSlide(preferredTrigger?: HTMLElement) {
    const view = this.slides[this.slideIndex]
    const image = view?.querySelector<HTMLImageElement>('img')
    const dialog = this.dialog
    if (!view || !image || !dialog) return
    this.trigger =
      preferredTrigger &&
      (view.contains(preferredTrigger) ||
        this.linkedViews.get(preferredTrigger) === view)
        ? preferredTrigger
        : (this.triggerFor(view) ?? preferredTrigger)
    const source =
      view
        .querySelector<HTMLTemplateElement>('template')
        ?.content.querySelector('img') ?? image
    const target = dialog.querySelector('img')!
    target.src = source.src
    target.alt = image.alt
    dialog.querySelector('p')!.textContent = image.alt
    const total = this.slides.length
    const current = this.slideIndex + 1
    if (this.indexLabel) this.indexLabel.textContent = `${current}/${total}`
    if (this.previousButton) this.previousButton.disabled = this.slideIndex <= 0
    if (this.nextButton) this.nextButton.disabled = this.slideIndex >= total - 1
  }

  private go(delta: number) {
    if (!this.dialog?.open || this.slides.length === 0) return
    const next = clampSlideIndex(this.slideIndex + delta, this.slides.length)
    if (next === this.slideIndex) return
    this.slideIndex = next
    this.showSlide()
  }

  /** 给带作者链接的视图补上仅键盘可见的大图入口；克隆副本和已接管的视图跳过。 */
  private bindViews() {
    for (const view of document.querySelectorAll<HTMLElement>(
      '.markdown-content .image-view'
    )) {
      if (view.dataset.imageViewBound) continue
      if (
        view.closest('[data-marquee-clone]') ||
        view.closest('.excalidraw-embed')
      )
        continue
      const image = view.querySelector<HTMLImageElement>('img')
      if (!image) continue
      view.dataset.imageViewBound = ''
      const link = image.closest('a')
      let trigger: HTMLElement = image
      if (link) {
        // Keep authored navigation; expose its separate zoom action on keyboard focus only.
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'image-view__linked-zoom'
        button.textContent = '查看大图'
        link.after(button)
        this.linkedViews.set(button, view)
        trigger = button
      } else {
        view.classList.add('image-view--interactive')
        image.tabIndex = 0
        image.setAttribute('role', 'button')
      }
      trigger.setAttribute('aria-label', `查看大图：${image.alt || '图片'}`)
      trigger.setAttribute('aria-haspopup', 'dialog')
    }
  }

  private bindGallery(gallery: HTMLElement, signal: AbortSignal) {
    const items = [
      ...gallery.querySelectorAll<HTMLElement>(':scope > .image-gallery__item'),
    ]
    if (items.length < 2) return
    const viewport = document.createElement('div')
    viewport.className = 'image-gallery__viewport'
    gallery.before(viewport)
    viewport.append(gallery)
    const button = (label: string, className: string) => {
      const node = document.createElement('button')
      node.type = 'button'
      node.className = className
      node.setAttribute('aria-label', label)
      return node
    }
    const previous = button(
      '上一张图片',
      'image-gallery__arrow image-gallery__arrow--previous'
    )
    const next = button(
      '下一张图片',
      'image-gallery__arrow image-gallery__arrow--next'
    )
    const controls = document.createElement('div')
    controls.className = 'image-gallery__controls'
    controls.setAttribute('role', 'group')
    controls.setAttribute('aria-label', '相册页码')
    const dots = items.map((_, index) => {
      const dot = button(`显示第 ${index + 1} 张图片`, 'image-gallery__dot')
      controls.append(dot)
      return dot
    })
    viewport.append(previous, next, controls)
    gallery.tabIndex = 0
    gallery.setAttribute('role', 'region')
    gallery.setAttribute('aria-label', '横向图片相册')
    let current = 0
    // Programmed page index: arrows/keys advance this so rapid clicks skip
    // correctly while smooth scrolling. Fling/snap syncs it back on settle.
    let target = 0
    // Snap/index use slide centers so mixed aspect ratios share one axis.
    const centerX = (el: Element) => {
      const rect = el.getBoundingClientRect()
      return rect.left + rect.width / 2
    }
    // Absolute scrollLeft that centers a slide (CSS snap uses the same axis).
    const idealLeft = (index: number) => {
      const item = items[Math.max(0, Math.min(items.length - 1, index))]
      return item.offsetLeft + item.offsetWidth / 2 - gallery.clientWidth / 2
    }
    const update = () => {
      const view = centerX(gallery)
      current = items.reduce(
        (nearest, item, index) =>
          Math.abs(centerX(item) - view) <
          Math.abs(centerX(items[nearest]) - view)
            ? index
            : nearest,
        0
      )
      // The stage height is fixed in CSS, so paging only moves the indicator.
      previous.disabled = current === 0
      next.disabled = current === items.length - 1
      dots.forEach((dot, index) => {
        dot.setAttribute('aria-current', index === current ? 'true' : 'false')
      })
      // Long galleries scroll their own pagination; reveal the active dot there
      // instead of moving the article.
      const dot = dots[current]
      const right = dot.offsetLeft + dot.offsetWidth
      if (dot.offsetLeft < controls.scrollLeft)
        controls.scrollLeft = dot.offsetLeft
      else if (right > controls.scrollLeft + controls.clientWidth)
        controls.scrollLeft = right - controls.clientWidth
    }
    // Sync target only after scrolling settles. Matching idealLeft during
    // scroll events also fires while a smooth go() passes intermediate
    // centers, which overwrote target and broke rapid next/prev.
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    const syncTarget = () => {
      target = current
    }
    const onScroll = () => {
      update()
      clearTimeout(settleTimer)
      settleTimer = setTimeout(syncTarget, 80)
    }
    const onScrollEnd = () => {
      clearTimeout(settleTimer)
      update()
      syncTarget()
    }
    const go = (index: number, behavior?: ScrollBehavior) => {
      target = Math.max(0, Math.min(items.length - 1, index))
      const reduced = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches
      gallery.scrollTo({
        left: idealLeft(target),
        // Relative scrollBy + smooth + mandatory snap can chain to the next
        // snap point (boot was advancing past slide 0; skip-dot stopped mid-way).
        behavior: behavior ?? (reduced ? 'instant' : 'smooth'),
      })
    }
    previous.addEventListener('click', () => go(target - 1), { signal })
    next.addEventListener('click', () => go(target + 1), { signal })
    dots.forEach((dot, index) =>
      dot.addEventListener('click', () => go(index), { signal })
    )
    gallery.addEventListener(
      'keydown',
      (event) => {
        if (
          event.target !== gallery ||
          !['ArrowLeft', 'ArrowRight'].includes(event.key)
        )
          return
        event.preventDefault()
        go(target + (event.key === 'ArrowLeft' ? -1 : 1))
      },
      { signal }
    )
    gallery.addEventListener('scroll', onScroll, { signal })
    gallery.addEventListener('scrollend', onScrollEnd, { signal })
    window.addEventListener(
      'resize',
      () => {
        update()
        syncTarget()
      },
      { signal }
    )
    // Lazy images start at 0×0; nearest-center then picks the wrong slide and
    // disables Next. Boot only after the first slide has real width.
    let booted = false
    const ro = new ResizeObserver(() => {
      if (booted || items[0].getBoundingClientRect().width < 2) return
      booted = true
      ro.disconnect()
      // Instant: a smooth scrollBy(≈0) was enough for snap to walk to slide 1.
      go(0, 'instant')
      update()
      syncTarget()
    })
    ro.observe(items[0])
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(settleTimer)
        ro.disconnect()
      },
      { once: true }
    )
    // Synchronous path when the first slide is already measured.
    if (items[0].getBoundingClientRect().width >= 2) {
      booted = true
      ro.disconnect()
      go(0, 'instant')
      update()
      syncTarget()
    }
  }

  private restore() {
    this.releaseScroll?.()
    this.releaseScroll = undefined
    this.slides = []
    this.slideIndex = 0
    if (this.trigger?.isConnected) this.trigger.focus({ preventScroll: true })
    this.trigger = undefined
    this.dialog?.querySelector('img')?.removeAttribute('src')
  }

  disconnectedCallback() {
    this.controller?.abort()
    this.controller = undefined
    this.trigger = undefined
    this.restore()
    this.linkedViews.clear()
    this.dialog?.remove()
    this.dialog = undefined
    this.indexLabel = undefined
    this.previousButton = undefined
    this.nextButton = undefined
  }
}
