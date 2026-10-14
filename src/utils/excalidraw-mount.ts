import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import {
  ExcalidrawCanvas,
  type ExcalidrawViewMode,
} from '~/components/excalidraw/ExcalidrawCanvas'

interface MountRecord {
  root: Root
  mode: ExcalidrawViewMode
}

const mounts = new WeakMap<HTMLElement, MountRecord>()

export const mountExcalidrawCanvas = (
  host: HTMLElement,
  opts: {
    sceneUrl: string
    mode: ExcalidrawViewMode
    onZoomChange?: (zoom: number) => void
    onReady?: () => void
    onError?: (message: string) => void
  }
) => {
  const existing = mounts.get(host)
  if (existing) {
    existing.root.unmount()
    mounts.delete(host)
  }
  const root = createRoot(host)
  root.render(
    createElement(ExcalidrawCanvas, {
      sceneUrl: opts.sceneUrl,
      mode: opts.mode,
      onZoomChange: opts.onZoomChange,
      onReady: opts.onReady,
      onError: opts.onError,
    })
  )
  mounts.set(host, { root, mode: opts.mode })
  return () => {
    root.unmount()
    mounts.delete(host)
  }
}
