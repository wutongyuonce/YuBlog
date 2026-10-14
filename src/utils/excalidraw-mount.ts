import { createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import {
  ExcalidrawCanvas,
  type ExcalidrawCanvasHandle,
  type ExcalidrawViewMode,
} from '~/components/excalidraw/ExcalidrawCanvas'

interface MountRecord {
  root: Root
  mode: ExcalidrawViewMode
}

const mounts = new WeakMap<HTMLElement, MountRecord>()

export interface MountExcalidrawOptions {
  sceneUrl: string
  mode: ExcalidrawViewMode
  onZoomChange?: (zoom: number) => void
  onReady?: () => void
  onError?: (message: string) => void
}

export interface MountExcalidrawResult {
  unmount: () => void
  api: ExcalidrawCanvasHandle
}

export const mountExcalidrawCanvas = (
  host: HTMLElement,
  opts: MountExcalidrawOptions
): MountExcalidrawResult => {
  const existing = mounts.get(host)
  if (existing) {
    existing.root.unmount()
    mounts.delete(host)
  }

  const canvasRef = createRef<ExcalidrawCanvasHandle>()
  const root = createRoot(host)
  root.render(
    createElement(ExcalidrawCanvas, {
      ref: canvasRef,
      sceneUrl: opts.sceneUrl,
      mode: opts.mode,
      onZoomChange: opts.onZoomChange,
      onReady: opts.onReady,
      onError: opts.onError,
    })
  )
  mounts.set(host, { root, mode: opts.mode })

  const api: ExcalidrawCanvasHandle = {
    zoomBy: (delta) => canvasRef.current?.zoomBy(delta),
    setZoom: (value) => canvasRef.current?.setZoom(value),
    fit: () => canvasRef.current?.fit(),
    getZoom: () => canvasRef.current?.getZoom() ?? 1,
  }

  return {
    unmount: () => {
      root.unmount()
      mounts.delete(host)
    },
    api,
  }
}
