/**
 * Read-only Excalidraw embed for YuBlog.
 * Native chrome hidden; custom bottom-right pill drives zoom/reset/expand/download.
 * Pill ± zooms around a fixed scene-space anchor (content center from fit),
 * so the same point stays centered — matching blog/user expectation vs innei.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Excalidraw as Board } from '@excalidraw/excalidraw'

interface ExcalidrawApi {
  scrollToContent: (target?: unknown, opts?: { fitToContent?: boolean }) => void
  getSceneElements: () => readonly unknown[]
  getAppState: () => {
    zoom: { value: number }
    scrollX: number
    scrollY: number
    width: number
    height: number
  }
  updateScene: (scene: {
    appState?: {
      zoom?: { value: number }
      scrollX?: number
      scrollY?: number
    }
  }) => void
}

export interface ExcalidrawCanvasHandle {
  /** Positive → × ZOOM_FACTOR; negative → ÷ ZOOM_FACTOR. */
  zoomBy: (delta: number) => void
  fit: () => void
  getZoom: () => number
  getFitZoom: () => number
}

export interface ExcalidrawCanvasProps {
  sceneUrl: string
  mode?: 'embed' | 'expand'
  downloadUrl?: string
  downloadName?: string
  onExpand?: () => void
  className?: string
  theme?: 'light' | 'dark'
  onZoomChange?: (zoom: number, fitZoom: number) => void
  onReady?: (api: ExcalidrawApi) => void
  onError?: (message: string) => void
}

interface ScenePayload {
  elements: readonly unknown[]
  appState?: Record<string, unknown>
  files?: Record<string, unknown>
}

interface ScenePoint {
  x: number
  y: number
}

const ZOOM_MIN = 0.1
const ZOOM_MAX = 30
/** Multiplicative zoom step (innei-style ×1.2 / ÷1.2). */
const ZOOM_FACTOR = 1.2

const readTheme = (): 'light' | 'dark' =>
  typeof document !== 'undefined' &&
  document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'light'

const clampZoom = (value: number) =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value))

const formatZoom = (zoom: number) => `${Math.round(zoom * 100)}%`

/**
 * Zoom around a fixed scene-space anchor (content center captured at fit).
 * Forces that anchor back to the viewport center on every ± so zoom always
 * scales about the same scene point — even after the user has panned.
 * Falls back to the current viewport-center scene point when no anchor yet.
 * Scene mapping: scene = local/zoom - scroll.
 */
const setZoomAroundAnchor = (
  api: ExcalidrawApi,
  nextZoom: number,
  anchor: ScenePoint | null
) => {
  const state = api.getAppState()
  const prev = state.zoom.value
  const next = clampZoom(nextZoom)
  if (Math.abs(next - prev) < 1e-6) return next

  const a =
    anchor ??
    ({
      x: state.width / 2 / prev - state.scrollX,
      y: state.height / 2 / prev - state.scrollY,
    } satisfies ScenePoint)

  api.updateScene({
    appState: {
      zoom: { value: next },
      scrollX: state.width / 2 / next - a.x,
      scrollY: state.height / 2 / next - a.y,
    },
  })
  return next
}

export const ExcalidrawCanvas = forwardRef<
  ExcalidrawCanvasHandle,
  ExcalidrawCanvasProps
>(function ExcalidrawCanvas(
  {
    sceneUrl,
    mode = 'embed',
    downloadUrl,
    downloadName,
    onExpand,
    className,
    theme: themeProp,
    onZoomChange,
    onReady,
    onError,
  },
  ref
) {
  const apiRef = useRef<ExcalidrawApi | undefined>(undefined)
  const fitZoomRef = useRef(1)
  /** Scene-space content center from last successful fit; not cleared on pan. */
  const anchorRef = useRef<ScenePoint | null>(null)
  const [scene, setScene] = useState<ScenePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [zoomLabel, setZoomLabel] = useState('—')
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => themeProp ?? readTheme()
  )

  useEffect(() => {
    if (themeProp) {
      setTheme(themeProp)
      return
    }
    const sync = () => setTheme(readTheme())
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    return () => observer.disconnect()
  }, [themeProp])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setScene(null)
    anchorRef.current = null
    ;(async () => {
      try {
        const response = await fetch(sceneUrl)
        if (!response.ok)
          throw new Error(`Failed to load scene (${response.status})`)
        const data = (await response.json()) as ScenePayload
        if (cancelled) return
        if (!Array.isArray(data.elements))
          throw new Error('Invalid .excalidraw scene: missing elements')
        setScene({
          elements: data.elements,
          appState: data.appState,
          files: data.files ?? {},
        })
      } catch (error) {
        if (cancelled) return
        onError?.(
          error instanceof Error ? error.message : 'Failed to load scene'
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sceneUrl, onError])

  const emitZoom = useCallback(
    (value?: number) => {
      const api = apiRef.current
      const zoom = value ?? api?.getAppState().zoom.value ?? 1
      setZoomLabel(formatZoom(zoom))
      onZoomChange?.(zoom, fitZoomRef.current)
    },
    [onZoomChange]
  )

  const fitToContent = useCallback(() => {
    const api = apiRef.current
    if (!api || api.getSceneElements().length === 0) return
    api.scrollToContent(undefined, { fitToContent: true })
    const s = api.getAppState()
    fitZoomRef.current = s.zoom.value
    // Capture content center in scene coords so ± always zooms about this point.
    anchorRef.current = {
      x: s.width / 2 / s.zoom.value - s.scrollX,
      y: s.height / 2 / s.zoom.value - s.scrollY,
    }
    emitZoom(fitZoomRef.current)
  }, [emitZoom])

  const zoomBy = useCallback(
    (delta: number) => {
      const api = apiRef.current
      if (!api) return
      const prev = api.getAppState().zoom.value
      const nextZoom =
        delta > 0 ? prev * ZOOM_FACTOR : prev / ZOOM_FACTOR
      const next = setZoomAroundAnchor(api, nextZoom, anchorRef.current)
      emitZoom(next)
    },
    [emitZoom]
  )

  useImperativeHandle(
    ref,
    () => ({
      zoomBy,
      fit: () => fitToContent(),
      getZoom: () => apiRef.current?.getAppState().zoom.value ?? 1,
      getFitZoom: () => fitZoomRef.current,
    }),
    [fitToContent, zoomBy]
  )

  const initialData = useMemo(() => {
    if (!scene) return null
    return {
      elements: scene.elements,
      appState: {
        ...(scene.appState ?? {}),
        collaborators: new Map(),
      },
      files: scene.files ?? {},
    }
  }, [scene])

  const showExpand = mode === 'embed' && Boolean(onExpand)
  const rootClass = ['excalidraw-view', `excalidraw-view--${mode}`, className]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={rootClass}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      {loading && (
        <div className="excalidraw-view__loading" role="status">
          加载画布…
        </div>
      )}

      {initialData && (
        <Board
          key={`${sceneUrl}:${theme}:${mode}`}
          theme={theme}
          initialData={initialData as never}
          detectScroll={true}
          zenModeEnabled
          viewModeEnabled
          gridModeEnabled={false}
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: false,
              clearCanvas: false,
              export: false,
              loadScene: false,
              saveToActiveFile: false,
              toggleTheme: false,
              saveAsImage: false,
            },
          }}
          onChange={(
            _elements: unknown,
            appState: { zoom: { value: number } }
          ) => {
            emitZoom(appState.zoom.value)
          }}
          excalidrawAPI={(api) => {
            const handle = api as unknown as ExcalidrawApi
            apiRef.current = handle
            window.setTimeout(() => {
              fitToContent()
              onReady?.(handle)
            }, 300)
          }}
        />
      )}

      <div
        className="excalidraw-pill"
        role="toolbar"
        aria-label="Excalidraw 图控制"
      >
        <button
          type="button"
          className="excalidraw-pill__btn"
          aria-label="缩小"
          title="缩小"
          onClick={() => zoomBy(-1)}
        >
          <span className="excalidraw-pill__icon excalidraw-pill__icon--zoom-out" />
        </button>
        <span className="excalidraw-pill__pct" aria-live="polite">
          {zoomLabel}
        </span>
        <button
          type="button"
          className="excalidraw-pill__btn"
          aria-label="放大"
          title="放大"
          onClick={() => zoomBy(1)}
        >
          <span className="excalidraw-pill__icon excalidraw-pill__icon--zoom-in" />
        </button>
        <span className="excalidraw-pill__sep" aria-hidden="true" />
        <button
          type="button"
          className="excalidraw-pill__btn"
          aria-label="复位"
          title="复位"
          onClick={() => fitToContent()}
        >
          <span className="excalidraw-pill__icon excalidraw-pill__icon--reset" />
        </button>
        {showExpand && (
          <>
            <span className="excalidraw-pill__sep" aria-hidden="true" />
            <button
              type="button"
              className="excalidraw-pill__btn"
              aria-label="展开"
              title="展开"
              onClick={() => onExpand?.()}
            >
              <span className="excalidraw-pill__icon excalidraw-pill__icon--expand" />
            </button>
          </>
        )}
        {downloadUrl && (
          <>
            <span className="excalidraw-pill__sep" aria-hidden="true" />
            <a
              className="excalidraw-pill__btn"
              href={downloadUrl}
              download={downloadName || true}
              rel="noopener noreferrer"
              aria-label="下载源文件"
              title="下载"
            >
              <span className="excalidraw-pill__icon excalidraw-pill__icon--download" />
            </a>
          </>
        )}
      </div>
    </div>
  )
})

export default ExcalidrawCanvas
