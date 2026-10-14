import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  forwardRef,
} from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/types/element/types'
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from '@excalidraw/excalidraw/types/types'

export type ExcalidrawViewMode = 'embed' | 'expand'

export interface ExcalidrawCanvasHandle {
  zoomBy: (delta: number) => void
  setZoom: (value: number) => void
  fit: () => void
  getZoom: () => number
}

export interface ExcalidrawCanvasProps {
  /** Static `/_media/…/*.excalidraw` URL (never a permanent blob:). */
  sceneUrl: string
  mode: ExcalidrawViewMode
  theme?: 'light' | 'dark'
  className?: string
  onZoomChange?: (zoom: number) => void
  onReady?: () => void
  onError?: (message: string) => void
}

interface ScenePayload {
  elements: readonly ExcalidrawElement[]
  appState?: Partial<AppState>
  files?: BinaryFiles
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

/**
 * Read-only Excalidraw canvas mirroring Shiro:
 * viewModeEnabled + zenModeEnabled, fitToContent, no editor chrome.
 * embed: single-finger pan + pinch; expand: single-finger pan locked.
 */
export const ExcalidrawCanvas = forwardRef<
  ExcalidrawCanvasHandle,
  ExcalidrawCanvasProps
>(function ExcalidrawCanvas(
  {
    sceneUrl,
    mode,
    theme: themeProp,
    className,
    onZoomChange,
    onReady,
    onError,
  },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const fittedRef = useRef(false)
  const [scene, setScene] = useState<ScenePayload | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => themeProp ?? readTheme()
  )
  const pointers = useRef(new Set<number>())

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
    fittedRef.current = false
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
        const message =
          error instanceof Error ? error.message : 'Failed to load scene'
        onError?.(message)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [sceneUrl, onError])

  const emitZoom = useCallback(() => {
    const api = apiRef.current
    if (!api) return
    onZoomChange?.(api.getAppState().zoom.value)
  }, [onZoomChange])

  const fitOnce = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      if (fittedRef.current) return
      if (api.getSceneElements().length === 0) return
      api.scrollToContent(undefined, { fitToContent: true })
      fittedRef.current = true
      emitZoom()
      onReady?.()
    },
    [emitZoom, onReady]
  )

  const applyZoom = useCallback(
    (next: number) => {
      const api = apiRef.current
      if (!api) return
      const value = clampZoom(next)
      api.updateScene({
        appState: {
          zoom: { value: value as AppState['zoom']['value'] },
        },
      })
      onZoomChange?.(value)
    },
    [onZoomChange]
  )

  useImperativeHandle(
    ref,
    () => ({
      zoomBy: (delta) => {
        const api = apiRef.current
        if (!api) return
        applyZoom(api.getAppState().zoom.value + delta)
      },
      setZoom: (value) => applyZoom(value),
      fit: () => {
        const api = apiRef.current
        if (!api) return
        api.scrollToContent(undefined, { fitToContent: true })
        emitZoom()
      },
      getZoom: () => apiRef.current?.getAppState().zoom.value ?? 1,
    }),
    [applyZoom, emitZoom]
  )

  const handleApi = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      apiRef.current = api
      // Shiro: scrollToContent after short delay once scene is ready
      window.setTimeout(() => fitOnce(api), 300)
      const id = window.setInterval(() => {
        if (!apiRef.current) {
          window.clearInterval(id)
          return
        }
        if (apiRef.current.getSceneElements().length > 0) {
          fitOnce(apiRef.current)
          window.clearInterval(id)
        }
      }, 16)
      window.setTimeout(() => window.clearInterval(id), 4000)
    },
    [fitOnce]
  )

  // Expand: block single-pointer pan; allow multi-touch pinch.
  useEffect(() => {
    if (mode !== 'expand') return
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
  }, [mode, scene])

  const initialData = useMemo(() => {
    if (!scene) return null
    return {
      elements: scene.elements,
      appState: {
        ...(scene.appState ?? {}),
        viewBackgroundColor:
          theme === 'dark'
            ? (scene.appState?.viewBackgroundColor ?? '#121212')
            : (scene.appState?.viewBackgroundColor ?? '#ffffff'),
        collaborators: new Map(),
      },
      files: scene.files ?? {},
      scrollToContent: true,
    }
  }, [scene, theme])

  if (!initialData) {
    return (
      <div
        className={[
          'excalidraw-canvas',
          'excalidraw-canvas--loading',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        role="status"
        aria-live="polite"
      >
        加载画布…
      </div>
    )
  }

  return (
    <div
      ref={hostRef}
      className={['excalidraw-canvas', `excalidraw-canvas--${mode}`, className]
        .filter(Boolean)
        .join(' ')}
      data-pan-locked={mode === 'expand' ? '1' : undefined}
      style={{ width: '100%', height: '100%' }}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <Excalidraw
        key={`${sceneUrl}:${theme}:${mode}`}
        excalidrawAPI={handleApi}
        initialData={initialData}
        viewModeEnabled
        zenModeEnabled
        gridModeEnabled={false}
        theme={theme}
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
        onScrollChange={() => emitZoom()}
        onChange={(_elements, appState) => {
          onZoomChange?.(appState.zoom.value)
        }}
        detectScroll={false}
        handleKeyboardGlobally={false}
      />
    </div>
  )
})

export default ExcalidrawCanvas
