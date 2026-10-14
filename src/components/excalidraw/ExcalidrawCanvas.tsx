/**
 * Read-only Excalidraw embed for YuBlog.
 * Rendering via @excalidraw/excalidraw (viewMode+zen); ALL native chrome hidden.
 * Custom bottom-right pill: − | % | + | | reset | | expand | download.
 * Types are local shims so astro check does not OOM on package d.ts.
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
  getAppState: () => { zoom: { value: number } }
  updateScene: (scene: { appState?: { zoom?: { value: number } } }) => void
}

export interface ExcalidrawCanvasHandle {
  zoomBy: (delta: number) => void
  fit: () => void
  getZoom: () => number
  getFitZoom: () => number
}

export interface ExcalidrawCanvasProps {
  sceneUrl: string
  /** Embed shows full pill; expand mode hides expand button. */
  mode?: 'embed' | 'expand'
  downloadUrl?: string
  downloadName?: string
  onExpand?: () => void
  className?: string
  theme?: 'light' | 'dark'
  onZoomChange?: (zoom: number, fitZoom: number) => void
  onReady?: (api: ExcalidrawApi) => void
  onError?: (message: string) => void
  /** Expand: block single-finger pan; keep multi-touch pinch. */
  panLocked?: boolean
}

interface ScenePayload {
  elements: readonly unknown[]
  appState?: Record<string, unknown>
  files?: Record<string, unknown>
}

const ZOOM_MIN = 0.1
const ZOOM_MAX = 3
const ZOOM_STEP = 0.1

const readTheme = (): 'light' | 'dark' =>
  typeof document !== 'undefined' &&
  document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'light'

const clampZoom = (value: number) =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value))

const formatZoom = (zoom: number) => `${Math.round(zoom * 100)}%`

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
    panLocked = false,
  },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<ExcalidrawApi | undefined>(undefined)
  const fitZoomRef = useRef(1)
  const pointers = useRef(new Set<number>())
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
    fitZoomRef.current = api.getAppState().zoom.value
    emitZoom(fitZoomRef.current)
  }, [emitZoom])

  const zoomBy = useCallback(
    (delta: number) => {
      const api = apiRef.current
      if (!api) return
      const next = clampZoom(api.getAppState().zoom.value + delta)
      api.updateScene({ appState: { zoom: { value: next } } })
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

  // Expand: block single-pointer pan; allow multi-touch pinch.
  useEffect(() => {
    if (!panLocked) return
    const el = hostRef.current
    if (!el) return
    const onDown = (event: PointerEvent) => {
      pointers.current.add(event.pointerId)
    }
    const onUp = (event: PointerEvent) => {
      pointers.current.delete(event.pointerId)
    }
    const onMove = (event: PointerEvent) => {
      if (pointers.current.size === 1) {
        event.stopImmediatePropagation()
        event.preventDefault()
      }
    }
    el.addEventListener('pointerdown', onDown, true)
    el.addEventListener('pointerup', onUp, true)
    el.addEventListener('pointercancel', onUp, true)
    el.addEventListener('pointermove', onMove, true)
    return () => {
      el.removeEventListener('pointerdown', onDown, true)
      el.removeEventListener('pointerup', onUp, true)
      el.removeEventListener('pointercancel', onUp, true)
      el.removeEventListener('pointermove', onMove, true)
      pointers.current.clear()
    }
  }, [panLocked, scene])

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
      ref={hostRef}
      className={rootClass}
      data-pan-locked={panLocked ? '1' : undefined}
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
          detectScroll={false}
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

      {/* Custom pill — only chrome the reader should see */}
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
          onClick={() => zoomBy(-ZOOM_STEP)}
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
          onClick={() => zoomBy(ZOOM_STEP)}
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
