import { lockScroll } from './misc'
import type { Drawing, DrawingView } from './excalidraw-canvas'

type CanvasModule = typeof import('./excalidraw-canvas')

/** Page-scoped loading, fallback and modal ownership; camera rules live in the canvas. */
export class ExcalidrawViewer extends HTMLElement {
  private controller?: AbortController
  private observer?: IntersectionObserver
  private cleanups: (() => void)[] = []
  private closeExpand?: () => void

  connectedCallback() {
    if (this.controller) return
    this.controller = new AbortController()
    const { signal } = this.controller
    const enhanced = new WeakSet<HTMLElement>()
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          this.observer?.unobserve(entry.target)
          void this.enhance(entry.target as HTMLElement, signal)
        }
      },
      { rootMargin: '300px' }
    )
    const discover = () => {
      for (const root of document.querySelectorAll<HTMLElement>(
        '.excalidraw-embed[data-excalidraw-viewer]'
      )) {
        if (enhanced.has(root)) continue
        enhanced.add(root)
        this.observer?.observe(root)
      }
    }
    discover()
    document.addEventListener('astro:page-load', discover, { signal })
  }

  disconnectedCallback() {
    this.closeExpand?.()
    this.controller?.abort()
    this.observer?.disconnect()
    for (const stop of this.cleanups.splice(0)) stop()
    this.controller = undefined
  }

  private async enhance(root: HTMLElement, signal: AbortSignal) {
    const host = root.querySelector<HTMLElement>('[data-excalidraw-host]')
    const source = root.querySelector<HTMLAnchorElement>(
      'a.excalidraw-embed__source'
    )
    if (!host || !source) return
    const label = root.getAttribute('aria-label') || 'Excalidraw 图'
    const status = document.createElement('p')
    status.className = 'excalidraw-embed__status'
    status.setAttribute('role', 'status')
    status.textContent = '加载画布…'
    host.append(status)
    try {
      const canvas = await import('./excalidraw-canvas')
      if (signal.aborted) return
      const drawing = await canvas.loadDrawing(source.href, signal)
      if (signal.aborted) {
        drawing.dispose()
        return
      }
      this.cleanups.push(drawing.dispose)
      const stop = canvas.createDrawingView(host, drawing, {
        label,
        sourceUrl: source.href,
        name: source.download,
        onExpand: (trigger, view) =>
          this.openExpand(canvas, drawing, {
            label,
            sourceUrl: source.href,
            name: source.download,
            trigger,
            view,
          }),
      })
      this.cleanups.push(stop)
      status.remove()
      root.classList.add('excalidraw-embed--canvas-ready')
    } catch (error) {
      if (signal.aborted) return
      console.error('Excalidraw 画布加载失败', error)
      status.textContent = '画布加载失败，可下载源文件查看。'
      root.classList.add('excalidraw-embed--error')
    }
  }

  private openExpand(
    canvas: CanvasModule,
    drawing: Drawing,
    options: {
      label: string
      sourceUrl: string
      name: string
      trigger: HTMLButtonElement
      view: DrawingView
    }
  ) {
    this.closeExpand?.()
    const dialog = document.createElement('dialog')
    dialog.className = 'excalidraw-expand'
    dialog.setAttribute('aria-label', `${options.label}：展开画布`)
    const frame = document.createElement('div')
    frame.className = 'excalidraw-expand__frame'
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'excalidraw-expand__close'
    close.setAttribute('aria-label', '关闭画布')
    close.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>'
    frame.append(close)
    dialog.append(frame)
    const stop = canvas.createDrawingView(frame, drawing, {
      label: options.label,
      sourceUrl: options.sourceUrl,
      name: options.name,
      initialView: options.view,
    })
    let releaseScroll: (() => void) | undefined
    let disposed = false
    const cleanup = () => {
      if (disposed) return
      disposed = true
      stop()
      dialog.remove()
      releaseScroll?.()
      this.closeExpand = undefined
      if (options.trigger.isConnected)
        options.trigger.focus({ preventScroll: true })
    }
    this.closeExpand = cleanup
    close.addEventListener('click', () => dialog.close())
    dialog.addEventListener('close', cleanup, { once: true })
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close()
    })
    document.body.append(dialog)
    try {
      dialog.showModal()
      releaseScroll = lockScroll()
      close.focus({ preventScroll: true })
    } catch (error) {
      cleanup()
      console.error('Excalidraw 展开失败', error)
    }
  }
}
