const ZOOM_STEP = 0.1

const resolveSceneUrl = (root: HTMLElement): string | null => {
  // Prefer the download <a> — rehype rewrites it to /_media/….
  const link = root.querySelector<HTMLAnchorElement>(
    'a.excalidraw-embed__source'
  )
  if (link?.getAttribute('href')) return link.href
  const fromData = root.getAttribute('data-excalidraw-src')?.trim()
  if (fromData) {
    if (fromData.startsWith('/') || /^https?:/i.test(fromData))
      return new URL(fromData, window.location.href).href
  }
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

/** Zoom bar: longer when zoomed out, shorter when zoomed in. */
const zoomBarScale = (zoom: number) => {
  const min = 0.1
  const max = 3
  const z = Math.min(max, Math.max(min, zoom || 1))
  const raw = min / z
  return Math.min(1, Math.max(0.18, raw * 2.2))
}

const formatZoom = (zoom: number) => `${Math.round(zoom * 100)}%`

type MountFn = typeof import('~/utils/excalidraw-mount').mountExcalidrawCanvas

/**
 * Mounts real Excalidraw canvases into :::excalidraw figures.
 * React + @excalidraw load only when an embed is present on the page.
 * Expand dialog: fixed box, single-finger pan locked, pinch/wheel zoom + zoom bar.
 */
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
    const zoomLabel = root.querySelector<HTMLElement>(
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
    const expandBtn = root.querySelector<HTMLButtonElement>(
      '.excalidraw-embed__expand'
    )

    const { unmount, api } = mountCanvas(host, {
      sceneUrl,
      mode: 'embed',
      onZoomChange: (zoom) => {
        if (zoomLabel) zoomLabel.textContent = formatZoom(zoom)
      },
      onReady: () => {
        fallback?.setAttribute('hidden', '')
        root.classList.add('excalidraw-embed--canvas-ready')
        if (zoomLabel) zoomLabel.textContent = formatZoom(api.getZoom())
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

    zoomOut?.addEventListener('click', () => api.zoomBy(-ZOOM_STEP), { signal })
    zoomIn?.addEventListener('click', () => api.zoomBy(ZOOM_STEP), { signal })
    reset?.addEventListener('click', () => api.fit(), { signal })
    expandBtn?.addEventListener(
      'click',
      () => this.openExpand(root, sceneUrl, mountCanvas),
      { signal }
    )
  }

  private openExpand(
    sourceRoot: HTMLElement,
    sceneUrl: string,
    mountCanvas: MountFn
  ) {
    const existing = document.querySelector('dialog.excalidraw-expand')
    existing?.remove()

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
    barTrack.append(barFill)

    const toolbar = document.createElement('div')
    toolbar.className = 'excalidraw-expand__toolbar'
    toolbar.setAttribute('role', 'toolbar')
    toolbar.setAttribute('aria-label', 'Excalidraw 展开控制')

    const zoomOut = document.createElement('button')
    zoomOut.type = 'button'
    zoomOut.className = 'excalidraw-expand__zoom-out'
    zoomOut.setAttribute('aria-label', '缩小')

    const zoomLabel = document.createElement('span')
    zoomLabel.className = 'excalidraw-expand__zoom-label'
    zoomLabel.setAttribute('aria-live', 'polite')
    zoomLabel.textContent = '100%'

    const zoomIn = document.createElement('button')
    zoomIn.type = 'button'
    zoomIn.className = 'excalidraw-expand__zoom-in'
    zoomIn.setAttribute('aria-label', '放大')

    const reset = document.createElement('button')
    reset.type = 'button'
    reset.className = 'excalidraw-expand__reset'
    reset.setAttribute('aria-label', '复位')

    const download = document.createElement('a')
    download.className = 'excalidraw-expand__download'
    download.href = sceneUrl
    download.download = downloadName(sourceRoot, sceneUrl)
    download.rel = 'noopener noreferrer'
    download.textContent = '下载'
    download.setAttribute('aria-label', '下载 Excalidraw 源文件')

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'excalidraw-expand__close'
    close.setAttribute('aria-label', '关闭')
    close.textContent = '关闭'

    toolbar.append(zoomOut, zoomLabel, zoomIn, reset, download, close)
    frame.append(host, barTrack, toolbar)
    dialog.append(frame)
    document.body.append(dialog)

    const { unmount, api } = mountCanvas(host, {
      sceneUrl,
      mode: 'expand',
      onZoomChange: (zoom) => {
        barFill.style.setProperty(
          '--zoom-bar-scale',
          String(zoomBarScale(zoom))
        )
        zoomLabel.textContent = formatZoom(zoom)
      },
    })

    zoomOut.addEventListener('click', () => api.zoomBy(-ZOOM_STEP))
    zoomIn.addEventListener('click', () => api.zoomBy(ZOOM_STEP))
    reset.addEventListener('click', () => api.fit())

    const cleanup = () => {
      unmount()
      dialog.remove()
    }

    close.addEventListener('click', () => {
      dialog.close()
    })
    dialog.addEventListener('close', cleanup)
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close()
    })

    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  }
}
