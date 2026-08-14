import * as React from 'react'
import { useCallback, useRef, useState } from 'react'

import type { WorkbenchViewMode } from './workbench-view-state'

const MIN_WORKFLOW_PERCENT = 30
const MAX_WORKFLOW_PERCENT = 70

export function WorkbenchDomainLayout({
  mode,
  workflow,
  material,
  device
}: {
  mode: WorkbenchViewMode
  workflow: React.ReactNode
  material: React.ReactNode
  device: React.ReactNode
}): React.JSX.Element {
  const layoutRef = useRef<HTMLDivElement>(null)
  const [workflowPercent, setWorkflowPercent] = useState(55)
  const setBoundedPercent = useCallback((value: number) => {
    setWorkflowPercent(Math.min(
      MAX_WORKFLOW_PERCENT,
      Math.max(MIN_WORKFLOW_PERCENT, value)
    ))
  }, [])
  const resizeFromPointer = useCallback((clientX: number) => {
    const bounds = layoutRef.current?.getBoundingClientRect()
    if (!bounds || bounds.width <= 0) return
    setBoundedPercent(((clientX - bounds.left) / bounds.width) * 100)
  }, [setBoundedPercent])
  const startResize = useCallback((event: React.PointerEvent) => {
    event.preventDefault()
    const move = (moveEvent: PointerEvent) => {
      resizeFromPointer(moveEvent.clientX)
    }
    const stop = () => {
      globalThis.removeEventListener('pointermove', move)
      globalThis.removeEventListener('pointerup', stop)
    }
    globalThis.addEventListener('pointermove', move)
    globalThis.addEventListener('pointerup', stop, { once: true })
  }, [resizeFromPointer])
  const resizeFromKeyboard = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    setBoundedPercent(workflowPercent + (event.key === 'ArrowLeft' ? -5 : 5))
  }, [setBoundedPercent, workflowPercent])

  const split = mode === 'split' || mode === 'device-material'
  const primaryDomain = mode === 'device-material' ? 'device' : 'workflow'
  const splitStyle = split
    ? {
        gridTemplateColumns:
          `minmax(0, ${workflowPercent}fr) 7px `
          + `minmax(0, ${100 - workflowPercent}fr)`
      }
    : undefined
  const workflowVisible = mode === 'workflow' || mode === 'split'
  const materialVisible = mode === 'material' || split
  const deviceVisible = mode === 'device' || mode === 'device-material'

  return (
    <main
      ref={layoutRef}
      className={`unilab-workbench__domain-layout is-${mode}`}
      data-workbench-view={mode}
      data-primary-domain={primaryDomain}
      style={splitStyle}
    >
      <div
        className="unilab-workbench__domain-slot is-workflow"
        hidden={!workflowVisible}
      >
        {workflow}
      </div>
      <div
        className="unilab-workbench__splitter"
        role="separator"
        aria-label={mode === 'device-material'
          ? '调整仪器设备与物料窗口宽度'
          : '调整工作流与物料窗口宽度'}
        aria-orientation="vertical"
        aria-valuemin={MIN_WORKFLOW_PERCENT}
        aria-valuemax={MAX_WORKFLOW_PERCENT}
        aria-valuenow={workflowPercent}
        hidden={!split}
        tabIndex={split ? 0 : -1}
        onPointerDown={startResize}
        onKeyDown={resizeFromKeyboard}
      >
        <span aria-hidden="true" />
      </div>
      <div
        className="unilab-workbench__domain-slot is-material"
        hidden={!materialVisible}
      >
        {material}
      </div>
      <div
        className="unilab-workbench__domain-slot is-device"
        hidden={!deviceVisible}
      >
        {device}
      </div>
    </main>
  )
}
