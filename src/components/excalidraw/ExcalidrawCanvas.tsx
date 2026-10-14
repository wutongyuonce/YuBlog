/**
 * Shiro-aligned read-only Excalidraw viewer.
 * Source: Innei/Shiro `apps/web/src/components/ui/excalidraw/Excalidraw.tsx`
 * Intentional YuBlog diffs: expand via <dialog> (not mobile blob:), plus
 * static `/_media/…excalidraw` download control.
 *
 * Types are local shims (not imported from @excalidraw/…/types) so
 * `astro check` does not OOM on the package's multi‑MB declarations.
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
  /** Static `/_media/…/*.excalidraw` (never a permanent blob: href). */
  sceneUrl: string
  showExpandButton?: boolean
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

const ZOOM_MIN = 0.1
const ZOOM_MAX = 3

const readTheme = (): 'light' | 'dark' =>
  typeof document !== 'undefined' &&
  document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'light'

const clampZoom = (value: number) =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value))

export const ExcalidrawCanvas = forwardRef<
  ExcalidrawCanvasHandle,
  ExcalidrawCanvasProps
>(function ExcalidrawCanvas(
  {
    sceneUrl,
    showExpandButton = true,
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
  const [scene, setScene] = useState<ScenePayload | null>(null)
  const [loading, setLoading] = useState(true)
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

  const emitZoom = useCallback(() => {
    const api = apiRef.current
    if (!api) return
    onZoomChange?.(api.getAppState().zoom.value, fitZoomRef.current)
  }, [onZoomChange])

  const fitToContent = useCallback(() => {
    const api = apiRef.current
    if (!api || api.getSceneElements().length === 0) return
    api.scrollToContent(undefined, { fitToContent: true })
    fitZoomRef.current = api.getAppState().zoom.value
    emitZoom()
  }, [emitZoom])

  useImperativeHandle(
    ref,
    () => ({
      zoomBy: (delta) => {
        const api = apiRef.current
        if (!api) return
        const next = clampZoom(api.getAppState().zoom.value + delta)
        api.updateScene({ appState: { zoom: { value: next } } })
        onZoomChange?.(next, fitZoomRef.current)
      },
      fit: () => fitToContent(),
      getZoom: () => apiRef.current?.getAppState().zoom.value ?? 1,
      getFitZoom: () => fitZoomRef.current,
    }),
    [fitToContent, onZoomChange]
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

  const rootClass = ['excalidraw-shiro', className].filter(Boolean).join(' ')

  return (
    <div
      className={rootClass}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      {loading && (
        <div className="excalidraw-shiro__loading" role="status">
          加载画布…
        </div>
      )}

      {initialData && (
        <Board
          key={`${sceneUrl}:${theme}`}
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
            onZoomChange?.(appState.zoom.value, fitZoomRef.current)
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

      {(showExpandButton || downloadUrl) && (
        <div className="excalidraw-shiro__actions">
          {downloadUrl && (
            <a
              className="excalidraw-shiro__action"
              href={downloadUrl}
              download={downloadName || true}
              rel="noopener noreferrer"
              aria-label="下载 Excalidraw 源文件"
              title="下载源文件"
            >
              <span
                className="excalidraw-shiro__action-icon"
                aria-hidden="true"
              >
                ↓
              </span>
            </a>
          )}
          {showExpandButton && (
            <button
              type="button"
              className="excalidraw-shiro__action"
              aria-label="展开画布"
              title="展开"
              onClick={() => onExpand?.()}
            >
              <span
                className="excalidraw-shiro__action-icon"
                aria-hidden="true"
              >
                ↗
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  )
})

export default ExcalidrawCanvas
