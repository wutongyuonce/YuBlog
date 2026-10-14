import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'

import '@excalidraw/excalidraw/index.css'

export type ExcalidrawViewMode = 'embed' | 'expand'

export interface ExcalidrawCanvasProps {
  /** Static `/_media/…/*.excalidraw` URL (never a permanent blob:). */
  sceneUrl: string
  mode: ExcalidrawViewMode
  /** Optional theme override; defaults to document `html.dark`. */
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

const readTheme = (): 'light' | 'dark' =>
  typeof document !== 'undefined' &&
  document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'light'

/**
 * Read-only Excalidraw canvas (view + zen).
 * embed: single-finger pan + pinch zoom, fit-to-content.
 * expand: pan locked for one finger; pinch / wheel zoom still work.
 */
export function ExcalidrawCanvas({
  sceneUrl,
  mode,
  theme: themeProp,
  className,
  onZoomChange,
  onReady,
  onError,
}: ExcalidrawCanvasProps) {
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

  const fitOnce = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      if (fittedRef.current) return
      if (api.getSceneElements().length === 0) return
      api.scrollToContent(undefined, { fitToContent: true })
      fittedRef.current = true
      onZoomChange?.(api.getAppState().zoom.value)
      onReady?.()
    },
    [onReady, onZoomChange]
  )

  const handleApi = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      apiRef.current = api
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

  // Expand mode: block single-finger / single-pointer pan; allow multi-touch pinch.
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
        onScrollChange={(_scrollX, _scrollY, zoom) => {
          onZoomChange?.(zoom.value)
        }}
        detectScroll={false}
        handleKeyboardGlobally={false}
      />
    </div>
  )
}

export default ExcalidrawCanvas
