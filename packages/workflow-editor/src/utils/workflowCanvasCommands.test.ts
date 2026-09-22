import { describe, expect, it } from 'vitest'

import {
  WORKFLOW_PROTOTYPE_ACTION_NODE_SIZE,
  workflowPaletteDropInside,
  workflowPaletteDropPosition
} from './workflowCanvasCommands'

describe('palette drop boundary', () => {
  const canvas = { left: 400, right: 900, top: 150, bottom: 700 }
  it('accepts the canvas and its edges', () => {
    expect(workflowPaletteDropInside(canvas, 650, 300)).toBe(true)
    expect(workflowPaletteDropInside(canvas, 400, 700)).toBe(true)
  })
  it.each([[200, 300], [1000, 300], [650, 100], [650, 800], [NaN, 300]])(
    'rejects release outside the canvas at %s, %s', (x, y) => {
      expect(workflowPaletteDropInside(canvas, x, y)).toBe(false)
    }
  )
  it('rejects an unmounted canvas', () => {
    expect(workflowPaletteDropInside(undefined, 650, 300)).toBe(false)
  })
})

describe('workflowPaletteDropPosition', () => {
  it('places the prototype-sized node centre at the pointer location', () => {
    expect(workflowPaletteDropPosition({ x: 420, y: 168 })).toEqual({
      x: 330,
      y: 126
    })
  })

  it('supports a custom node size for non-action palette entries', () => {
    expect(workflowPaletteDropPosition(
      { x: 100, y: 80 },
      { width: 40, height: 20 }
    )).toEqual({ x: 80, y: 70 })
  })

  it('uses the HTML prototype action card dimensions by default', () => {
    expect(WORKFLOW_PROTOTYPE_ACTION_NODE_SIZE).toEqual({
      width: 180,
      height: 84
    })
  })
})
