import { describe, expect, it } from 'vitest'

import {
  WORKFLOW_PROTOTYPE_ACTION_NODE_SIZE,
  workflowPaletteDropPosition
} from './workflowCanvasCommands'

describe('workflowPaletteDropPosition', () => {
  it('places the prototype-sized node centre at the pointer location', () => {
    expect(workflowPaletteDropPosition({ x: 420, y: 168 })).toEqual({
      x: 354,
      y: 135
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
      width: 132,
      height: 66
    })
  })
})
