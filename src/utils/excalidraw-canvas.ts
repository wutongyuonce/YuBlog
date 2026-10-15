import {
  drawingFit,
  drawingTransform,
  MAX_DRAWING_ZOOM,
  MIN_DRAWING_ZOOM,
  panDrawing,
  zoomDrawing,
} from './excalidraw-viewport.js'

export interface DrawingView {
  x: number
  y: number
  zoom: number
}

export interface Drawing {
  width: number
  height: number
  url: string
  background: string
  dispose: () => void
}

/** Keep the editor and its CSS out of the reader. Only use the official exporter. */
export async function loadDrawing(
  url: string,
  signal: AbortSignal
): Promise<Drawing> {
  Object.assign(window, {
    EXCALIDRAW_ASSET_PATH: `${import.meta.env.BASE_URL}excalidraw-assets/`,
  })
  const [response, { restore, exportToSvg }] = await Promise.all([
    fetch(url, { signal }),
    import('@excalidraw/excalidraw'),
  ])
  if (!response.ok) throw new Error(`源文件请求失败（${response.status}）`)
  const data = await response.json()
  if (!Array.isArray(data.elements))
    throw new Error('源文件不是 Excalidraw 场景')
  const scene = restore(data, null, null)
  const elements = scene.elements.filter((element) => !element.isDeleted)
  if (!elements.length) throw new Error('源文件中没有可显示的图形')
  const svg = await exportToSvg({
    elements,
    files: scene.files,
    appState: {
      ...scene.appState,
      exportBackground: true,
      exportScale: 1,
      exportWithDarkMode: false,
      exportEmbedScene: false,
    },
    exportPadding: 16,
  })
  signal.throwIfAborted()
  const width = Number(svg.getAttribute('width'))
  const height = Number(svg.getAttribute('height'))
  if (!(width > 0 && height > 0)) throw new Error('画布尺寸无效')
  const imageUrl = URL.createObjectURL(
    new Blob([svg.outerHTML], { type: 'image/svg+xml' })
  )
  // SVG images isolate exported links/styles and retain the embedded font subsets.
  const image = new Image()
  image.src = imageUrl
  try {
    await image.decode()
    signal.throwIfAborted()
  } catch (error) {
    URL.revokeObjectURL(imageUrl)
    throw error
  }
  return {
    width,
    height,
    url: imageUrl,
    background: scene.appState.viewBackgroundColor,
    dispose: () => URL.revokeObjectURL(imageUrl),
  }
}

const icons = {
  minus:
    '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4M7.5 10.5h6"/>',
  plus: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4M7.5 10.5h6m-3-3v6"/>',
  fit: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 18 17"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
} as const

const icon = (name: keyof typeof icons) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`

/** One camera implementation for both the article card and its modal. */
export function createDrawingView(
  host: HTMLElement,
  drawing: Drawing,
  options: {
    label: string
    sourceUrl: string
    name: string
    initialView?: DrawingView
    onExpand?: (trigger: HTMLButtonElement, view: DrawingView) => void
  }
) {
  const controller = new AbortController()
  const { signal } = controller
  const root = document.createElement('div')
  root.className = 'excalidraw-view'
  const surface = document.createElement('div')
  surface.className = 'excalidraw-view__surface'
  surface.style.backgroundColor = drawing.background
  surface.tabIndex = 0
  surface.setAttribute('role', 'group')
  surface.setAttribute('aria-label', options.label)
  surface.setAttribute(
    'aria-keyshortcuts',
    '+ - 0 ArrowUp ArrowDown ArrowLeft ArrowRight'
  )
  const image = document.createElement('img')
  image.className = 'excalidraw-view__image'
  image.src = drawing.url
  image.alt = options.label
  image.draggable = false
  image.width = drawing.width
  image.height = drawing.height
  surface.append(image)
  const toolbar = document.createElement('div')
  toolbar.className = 'excalidraw-pill'
  toolbar.setAttribute('role', 'group')
  toolbar.setAttribute('aria-label', '画布控制')
  const button = (
    label: string,
    symbol: keyof typeof icons,
    action: (button: HTMLButtonElement) => void
  ) => {
    const node = document.createElement('button')
    node.type = 'button'
    node.className = 'excalidraw-pill__btn'
    node.title = label
    node.setAttribute('aria-label', label)
    node.innerHTML = icon(symbol)
    node.addEventListener('click', () => action(node), { signal })
    toolbar.append(node)
    return node
  }
  const separator = () => {
    const node = document.createElement('span')
    node.className = 'excalidraw-pill__sep'
    node.setAttribute('aria-hidden', 'true')
    toolbar.append(node)
  }
  let view = options.initialView ?? {
    x: drawing.width / 2,
    y: drawing.height / 2,
    zoom: 1,
  }
  let frame = { width: 0, height: 0 }
  let fit = 1
  const zoom = (factor: number) => {
    view = zoomDrawing(view, view.zoom * factor, fit)
    paint()
  }
  const reset = () => {
    view = { x: drawing.width / 2, y: drawing.height / 2, zoom: 1 }
    paint()
  }
  const minus = button('缩小', 'minus', () => zoom(1 / 1.2))
  const percentage = document.createElement('output')
  percentage.className = 'excalidraw-pill__pct'
  percentage.setAttribute('aria-label', '缩放比例')
  toolbar.append(percentage)
  const plus = button('放大', 'plus', () => zoom(1.2))
  separator()
  button('适应画布', 'fit', reset)
  if (options.onExpand) {
    separator()
    button('展开画布', 'expand', (trigger) =>
      options.onExpand?.(trigger, { ...view })
    )
  }
  separator()
  const download = document.createElement('a')
  download.className = 'excalidraw-pill__btn'
  download.href = options.sourceUrl
  download.download = options.name
  download.title = '下载源文件'
  download.setAttribute('aria-label', '下载源文件')
  download.innerHTML = icon('download')
  toolbar.append(download)
  root.append(surface, toolbar)
  host.append(root)

  function paint() {
    view = zoomDrawing(view, view.zoom, fit)
    const transform = drawingTransform(view, frame, fit)
    image.style.transform = `matrix(${transform.scale}, 0, 0, ${transform.scale}, ${transform.x}, ${transform.y})`
    image.style.visibility = 'visible'
    percentage.value = `${Math.round(transform.scale * 100)}%`
    minus.disabled = transform.scale <= MIN_DRAWING_ZOOM + 1e-9
    plus.disabled = transform.scale >= MAX_DRAWING_ZOOM - 1e-9
  }
  const observer = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect
    if (!width || !height) return
    frame = { width, height }
    fit = drawingFit(drawing, frame)
    paint()
  })
  observer.observe(surface)

  const pointers = new Map<number, { x: number; y: number }>()
  const distance = () => {
    const [a, b] = [...pointers.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  surface.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0) return
      surface.focus({ preventScroll: true })
      surface.setPointerCapture(event.pointerId)
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      surface.classList.add('is-dragging')
    },
    { signal }
  )
  surface.addEventListener(
    'pointermove',
    (event) => {
      const previous = pointers.get(event.pointerId)
      if (!previous) return
      const before = pointers.size === 2 ? distance() : 0
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pointers.size === 1) {
        view = panDrawing(
          view,
          event.clientX - previous.x,
          event.clientY - previous.y,
          fit
        )
        paint()
      } else if (pointers.size === 2 && before > 0) {
        zoom(distance() / before)
      }
    },
    { signal }
  )
  const release = (event: PointerEvent) => {
    pointers.delete(event.pointerId)
    if (!pointers.size) surface.classList.remove('is-dragging')
  }
  surface.addEventListener('pointerup', release, { signal })
  surface.addEventListener('pointercancel', release, { signal })
  surface.addEventListener('lostpointercapture', release, { signal })
  surface.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        zoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.01))
      }
    },
    { signal, passive: false }
  )
  surface.addEventListener(
    'keydown',
    (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '+' || event.key === '=') zoom(1.2)
      else if (event.key === '-') zoom(1 / 1.2)
      else if (event.key === '0') reset()
      else if (
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      ) {
        const dx =
          event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0
        const dy =
          event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0
        view = panDrawing(view, dx, dy, fit)
        paint()
      } else return
      event.preventDefault()
      event.stopPropagation()
    },
    { signal }
  )

  return () => {
    controller.abort()
    observer.disconnect()
    pointers.clear()
    root.remove()
  }
}
