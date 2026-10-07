import { lockScroll } from './misc'

/** Owns gallery controls, the modal viewer and their page-scoped resources. */
export class ImageInteractions extends HTMLElement {
  private controller?: AbortController
  private dialog?: HTMLDialogElement
  private trigger?: HTMLElement
  private releaseScroll?: () => void

  connectedCallback() {
    if (this.controller) return
    this.controller = new AbortController()
    const { signal } = this.controller

    const dialog = document.createElement('dialog')
    dialog.className = 'image-lightbox'
    dialog.setAttribute('aria-label', '图片大图')
    dialog.innerHTML = `<div class="image-lightbox__panel">
      <button type="button" class="image-lightbox__close" aria-label="关闭大图">×</button>
      <img alt="">
      <p class="image-lightbox__caption"></p>
    </div>`
    document.body.append(dialog)
    this.dialog = dialog
    const close = () => {
      dialog.close()
      this.restore()
    }
    dialog.querySelector('button')!.addEventListener('click', close, { signal })
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

    for (const view of document.querySelectorAll<HTMLElement>(
      '.markdown-content .image-view'
    )) {
      const image = view.querySelector<HTMLImageElement>('img')
      if (!image) continue
      const link = image.closest('a')
      let trigger: HTMLElement = image
      if (link) {
        // Keep authored navigation; expose its separate zoom action on keyboard focus only.
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'image-view__linked-zoom'
        button.textContent = '查看大图'
        link.after(button)
        trigger = button
      } else {
        view.classList.add('image-view--interactive')
        image.tabIndex = 0
        image.setAttribute('role', 'button')
      }
      trigger.setAttribute('aria-label', `查看大图：${image.alt || '图片'}`)
      trigger.setAttribute('aria-haspopup', 'dialog')
      const open = () => {
        if (dialog.open) return
        this.trigger = trigger
        const source =
          view
            .querySelector<HTMLTemplateElement>('template')
            ?.content.querySelector('img') ?? image
        const target = dialog.querySelector('img')!
        target.src = source.src
        target.alt = image.alt
        dialog.querySelector('p')!.textContent = image.alt
        this.releaseScroll = lockScroll()
        dialog.showModal()
      }
      trigger.addEventListener(
        'click',
        (event) => {
          event.preventDefault()
          event.stopPropagation()
          open()
        },
        { signal }
      )
      if (!link) {
        image.addEventListener(
          'keydown',
          (event) => {
            if (!['Enter', ' '].includes(event.key)) return
            event.preventDefault()
            open()
          },
          { signal }
        )
      }
    }

    for (const gallery of document.querySelectorAll<HTMLElement>(
      '.markdown-content .image-gallery--scroll'
    )) {
      this.bindGallery(gallery, signal)
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
    const update = () => {
      const left = gallery.getBoundingClientRect().left
      current = items.reduce(
        (nearest, item, index) =>
          Math.abs(item.getBoundingClientRect().left - left) <
          Math.abs(items[nearest].getBoundingClientRect().left - left)
            ? index
            : nearest,
        0
      )
      // Match the active frame, not the tallest off-screen portrait.
      const frame = items[current].querySelector<HTMLElement>('.image-view')
      if (frame)
        gallery.style.height = `${frame.getBoundingClientRect().height}px`
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
    const go = (index: number) => {
      const item = items[Math.max(0, Math.min(items.length - 1, index))]
      gallery.scrollBy({
        left:
          item.getBoundingClientRect().left -
          gallery.getBoundingClientRect().left,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      })
    }
    previous.addEventListener('click', () => go(current - 1), { signal })
    next.addEventListener('click', () => go(current + 1), { signal })
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
        go(current + (event.key === 'ArrowLeft' ? -1 : 1))
      },
      { signal }
    )
    gallery.addEventListener('scroll', update, { signal })
    window.addEventListener('resize', update, { signal })
    const observer = new ResizeObserver(update)
    for (const item of items) {
      const frame = item.querySelector('.image-view')
      if (frame) observer.observe(frame)
    }
    signal.addEventListener('abort', () => observer.disconnect(), {
      once: true,
    })
    update()
  }

  private restore() {
    this.releaseScroll?.()
    this.releaseScroll = undefined
    if (this.trigger?.isConnected) this.trigger.focus({ preventScroll: true })
    this.trigger = undefined
    this.dialog?.querySelector('img')?.removeAttribute('src')
  }

  disconnectedCallback() {
    this.controller?.abort()
    this.controller = undefined
    this.trigger = undefined
    this.restore()
    this.dialog?.remove()
    this.dialog = undefined
  }
}
