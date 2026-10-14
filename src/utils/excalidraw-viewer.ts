/**
 * Mount Excalidraw canvases into :::excalidraw figures.
 * Embed: custom pill only (native chrome CSS-hidden).
 * Expand: dialog + L–R zoom bar + download; single-finger pan locked.
 */

type MountFn = typeof import('~/utils/excalidraw-mount').mountExcalidrawCanvas

const resolveSceneUrl = (root: HTMLElement): string | null => {
  const link = root.querySelector<HTMLAnchorElement>(
    'a.excalidraw-embed__source'
  )
  if (link?.getAttribute('href')) return link.href
  const fromData = root.getAttribute('data-excalidraw-src')?.trim()
  if (fromData && (fromData.startsWith('/') || /^https?:/i.test(fromData)))
    return new URL(fromData, window.location.href).href
  return null
}

const downloadName = (root: HTMLElement, sceneUrl: string) => {
  const link = root.querySelector<HTMLAnchorElement>(
    'a.excalidraw-embed__source'
  )
  const attr = link?.getAttribute('download')?.trim()
  if (attr) return attr
  try {
    return decodeURIComponent(
      new URL(sceneUrl).pathname.split('/').pop() || 'drawing.excalidraw'
    )
  } catch {
    return 'drawing.excalidraw'
  }
}

/** Longest at fit, shortest at max zoom; full track at fit. */
const zoomBarScale = (zoom: number, fitZoom: number) => {
  const minZ = Math.max(0.05, Math.min(fitZoom || 1, zoom || 1))
  const maxZ = 3
  if (maxZ <= minZ) return 1
  const t = (zoom - minZ) / (maxZ - minZ)
  return Math.min(1, Math.max(0.1, 1 - t))
}

export class ExcalidrawViewer extends HTMLElement {
  private controller?: AbortController
  private cleanups: (() => void)[] = []

  connectedCallback() {
    if (this.controller) return
    this.controller = new AbortController()
    const { signal } = this.controller
    void this.enhanceAll(signal)
    document.addEventListener(
      'astro:page-load',
      () => {
        void this.enhanceAll(signal)
      },
      { signal }
    )
  }

  disconnectedCallback() {
    for (const stop of this.cleanups.splice(0)) stop()
    this.controller?.abort()
    this.controller = undefined
  }

  private async enhanceAll(signal: AbortSignal) {
    for (const stop of this.cleanups.splice(0)) stop()
    const roots = [
      ...document.querySelectorAll<HTMLElement>(
        '.excalidraw-embed[data-excalidraw-viewer]'
      ),
    ]
    if (!roots.length || signal.aborted) return

    const { mountExcalidrawCanvas } = await import('~/utils/excalidraw-mount')
    if (signal.aborted) return

    for (const root of roots) {
      if (signal.aborted) return
      this.enhance(root, signal, mountExcalidrawCanvas)
    }
  }

  private enhance(
    root: HTMLElement,
    signal: AbortSignal,
    mountCanvas: MountFn
  ) {
    const host = root.querySelector<HTMLElement>('[data-excalidraw-host]')
    const sceneUrl = resolveSceneUrl(root)
    if (!host || !sceneUrl) return

    root.classList.add('excalidraw-embed--enhanced')
    root.dataset.excalidrawReady = '1'

    const fallback = root.querySelector<HTMLElement>(
      '.excalidraw-embed__fallback'
    )
    const name = downloadName(root, sceneUrl)

    const { unmount } = mountCanvas(host, {
      sceneUrl,
      mode: 'embed',
      downloadUrl: sceneUrl,
      downloadName: name,
      onExpand: () => this.openExpand(sceneUrl, name, mountCanvas),
      onReady: () => {
        fallback?.setAttribute('hidden', '')
        root.classList.add('excalidraw-embed--canvas-ready')
      },
      onError: (message) => {
        root.classList.add('excalidraw-embed--error')
        host.replaceChildren()
        const tip = document.createElement('p')
        tip.className = 'excalidraw-embed__error'
        tip.textContent = fallback
          ? '画布加载失败，已保留预览图。'
          : `画布加载失败：${message}`
        host.append(tip)
        if (fallback) fallback.removeAttribute('hidden')
      },
    })
    this.cleanups.push(unmount)
    signal.addEventListener('abort', unmount, { once: true })
  }

  private openExpand(sceneUrl: string, name: string, mountCanvas: MountFn) {
    document.querySelector('dialog.excalidraw-expand')?.remove()

    const dialog = document.createElement('dialog')
    dialog.className = 'excalidraw-expand'
    dialog.setAttribute('aria-label', 'Excalidraw 展开视图')

    const frame = document.createElement('div')
    frame.className = 'excalidraw-expand__frame'

    const host = document.createElement('div')
    host.className = 'excalidraw-expand__host'
    host.dataset.excalidrawHost = ''

    const barTrack = document.createElement('div')
    barTrack.className = 'excalidraw-expand__zoom-bar'
    barTrack.setAttribute('aria-hidden', 'true')
    const barFill = document.createElement('div')
    barFill.className = 'excalidraw-expand__zoom-bar-fill'
    barFill.style.setProperty('--zoom-bar-scale', '1')
    barTrack.append(barFill)

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'excalidraw-expand__close'
    close.setAttribute('aria-label', '关闭')
    close.textContent = '关闭'

    frame.append(host, barTrack, close)
    dialog.append(frame)
    document.body.append(dialog)

    let fitZoom = 1
    const { unmount } = mountCanvas(host, {
      sceneUrl,
      mode: 'expand',
      downloadUrl: sceneUrl,
      downloadName: name,
      panLocked: true,
      className: 'excalidraw-view--in-dialog',
      onReady: (api) => {
        fitZoom = api.getAppState().zoom.value
        barFill.style.setProperty(
          '--zoom-bar-scale',
          String(zoomBarScale(fitZoom, fitZoom))
        )
      },
      onZoomChange: (zoom, fit) => {
        fitZoom = fit || fitZoom
        barFill.style.setProperty(
          '--zoom-bar-scale',
          String(zoomBarScale(zoom, fitZoom))
        )
      },
    })

    const cleanup = () => {
      unmount()
      dialog.remove()
    }
    close.addEventListener('click', () => dialog.close())
    dialog.addEventListener('close', cleanup)
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close()
    })

    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  }
}
