import { createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import {
  ExcalidrawCanvas,
  type ExcalidrawCanvasHandle,
  type ExcalidrawCanvasProps,
} from '~/components/excalidraw/ExcalidrawCanvas'

const mounts = new WeakMap<HTMLElement, Root>()

export type MountExcalidrawOptions = ExcalidrawCanvasProps

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
    existing.unmount()
    mounts.delete(host)
  }

  const canvasRef = createRef<ExcalidrawCanvasHandle>()
  const root = createRoot(host)
  root.render(createElement(ExcalidrawCanvas, { ...opts, ref: canvasRef }))
  mounts.set(host, root)

  const api: ExcalidrawCanvasHandle = {
    zoomBy: (delta) => canvasRef.current?.zoomBy(delta),
    fit: () => canvasRef.current?.fit(),
    getZoom: () => canvasRef.current?.getZoom() ?? 1,
    getFitZoom: () => canvasRef.current?.getFitZoom() ?? 1,
  }

  return {
    unmount: () => {
      root.unmount()
      mounts.delete(host)
    },
    api,
  }
}
