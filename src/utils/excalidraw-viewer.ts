const ZOOM_MIN = 0.25
const ZOOM_MAX = 4
const ZOOM_STEP = 0.1

const reduceMotion = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches

/** Pan/zoom toolbar for :::excalidraw embeds. One listener root; enhances each figure. */
export class ExcalidrawViewer extends HTMLElement {
  private controller?: AbortController

  connectedCallback() {
    if (this.controller) return
    this.controller = new AbortController()
    const { signal } = this.controller
    this.enhanceAll(signal)
    document.addEventListener(
      'astro:page-load',
      () => this.enhanceAll(signal),
      { signal }
    )
  }

  disconnectedCallback() {
    this.controller?.abort()
    this.controller = undefined
  }

  private enhanceAll(signal: AbortSignal) {
    for (const root of document.querySelectorAll<HTMLElement>(
      '.excalidraw-embed[data-excalidraw-viewer]'
    )) {
      if (root.dataset.excalidrawReady === '1') continue
      root.dataset.excalidrawReady = '1'
      this.enhance(root, signal)
    }
  }

  private enhance(root: HTMLElement, signal: AbortSignal) {
    const viewport = root.querySelector<HTMLElement>(
      '.excalidraw-embed__viewport'
    )
    const canvas = root.querySelector<HTMLElement>('.excalidraw-embed__canvas')
    const label = root.querySelector<HTMLElement>(
      '.excalidraw-embed__zoom-label'
    )
    const zoomOut = root.querySelector<HTMLButtonElement>(
      '.excalidraw-embed__zoom-out'
    )
    const zoomIn = root.querySelector<HTMLButtonElement>(
      '.excalidraw-embed__zoom-in'
    )
    const reset = root.querySelector<HTMLButtonElement>(
      '.excalidraw-embed__reset'
    )
    if (!viewport || !canvas || !label || !zoomOut || !zoomIn || !reset) return

    root.classList.add('excalidraw-embed--enhanced')

    let scale = 1
    let tx = 0
    let ty = 0
    let fitScale = 1
    let dragging = false
    let lastX = 0
    let lastY = 0

    const apply = () => {
      const transform = `translate(${tx}px, ${ty}px) scale(${scale})`
      canvas.style.transform = transform
      if (!reduceMotion()) canvas.style.transition = 'transform 120ms ease-out'
      else canvas.style.transition = 'none'
      label.textContent = `${Math.round(scale * 100)}%`
      zoomOut.disabled = scale <= ZOOM_MIN + 1e-6
      zoomIn.disabled = scale >= ZOOM_MAX - 1e-6
    }

    const fit = () => {
      const img = canvas.querySelector('img')
      const vw = viewport.clientWidth
      const vh = viewport.clientHeight
      const iw = img?.naturalWidth || canvas.scrollWidth || vw
      const ih = img?.naturalHeight || canvas.scrollHeight || vh
      if (iw > 0 && ih > 0 && vw > 0 && vh > 0)
        fitScale = Math.min(vw / iw, vh / ih, 1)
      else fitScale = 1
      scale = fitScale
      tx = 0
      ty = 0
      apply()
    }

    const clampZoom = (next: number) =>
      Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next))

    const zoomBy = (delta: number) => {
      scale = clampZoom(scale + delta)
      apply()
    }

    zoomOut.addEventListener('click', () => zoomBy(-ZOOM_STEP), { signal })
    zoomIn.addEventListener('click', () => zoomBy(ZOOM_STEP), { signal })
    reset.addEventListener('click', () => fit(), { signal })

    root.addEventListener(
      'keydown',
      (event) => {
        if (event.target !== root) return
        if (event.key === '+' || event.key === '=') {
          event.preventDefault()
          zoomBy(ZOOM_STEP)
        } else if (event.key === '-' || event.key === '_') {
          event.preventDefault()
          zoomBy(-ZOOM_STEP)
        } else if (event.key === '0') {
          event.preventDefault()
          fit()
        }
      },
      { signal }
    )

    viewport.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0) return
        dragging = true
        lastX = event.clientX
        lastY = event.clientY
        viewport.setPointerCapture(event.pointerId)
        viewport.classList.add('is-dragging')
      },
      { signal }
    )
    viewport.addEventListener(
      'pointermove',
      (event) => {
        if (!dragging) return
        tx += event.clientX - lastX
        ty += event.clientY - lastY
        lastX = event.clientX
        lastY = event.clientY
        apply()
      },
      { signal }
    )
    const endDrag = (event: PointerEvent) => {
      if (!dragging) return
      dragging = false
      viewport.classList.remove('is-dragging')
      try {
        viewport.releasePointerCapture(event.pointerId)
      } catch {
        /* already released */
      }
    }
    viewport.addEventListener('pointerup', endDrag, { signal })
    viewport.addEventListener('pointercancel', endDrag, { signal })

    viewport.addEventListener(
      'wheel',
      (event) => {
        if (!(event.ctrlKey || event.metaKey)) return
        event.preventDefault()
        const direction = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
        zoomBy(direction)
      },
      { signal, passive: false }
    )

    const img = canvas.querySelector('img')
    if (img && !img.complete)
      img.addEventListener('load', () => fit(), { signal, once: true })
    else fit()

    const ro =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            const current = scale
            const ratio = fitScale === 0 ? 1 : current / fitScale
            fit()
            scale = clampZoom(fitScale * ratio)
            apply()
          })
        : null
    ro?.observe(viewport)
    signal.addEventListener('abort', () => ro?.disconnect())
  }
}
