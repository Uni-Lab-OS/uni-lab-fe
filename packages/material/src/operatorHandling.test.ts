import { describe, expect, it, vi } from 'vitest'

import {
  MATERIAL_HANDLING_DRAG_TYPE,
  isMaterialListHandlingDraggable,
  readMaterialHandlingDragData,
  writeMaterialHandlingDragData
} from './operatorHandling'
import { materialAggregate } from './testFixtures'

describe('material list handling drag contract', () => {
  it('allows only unoccupied top-level operator-handled materials', () => {
    const unplaced = materialAggregate('beaker', {
      placement: { kind: 'unplaced' },
      config: { rendering: { kind: 'beaker' } }
    })
    const detachedWithPosition = materialAggregate('detached', {
      config: { rendering: { kind: 'beaker' } }
    })
    const occupied = materialAggregate('occupied', {
      placement: {
        kind: 'site',
        parentId: 'warehouse',
        siteId: 'site-1',
        offsetPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      },
      config: { rendering: { kind: 'beaker' } }
    })
    const equipment = materialAggregate('warehouse', {
      placement: { kind: 'unplaced' },
      config: { rendering: { kind: 'warehouse' } }
    })
    const backendBeaker = materialAggregate('backend-beaker', {
      config: {
        rendering: { kind: 'beaker' },
        resourceTemplate: { resourceType: 'resource' }
      }
    })
    backendBeaker.material.name = '烧杯堆栈2 L1B1 烧杯 500 mL'
    const backendDevice = materialAggregate('backend-plc', {
      config: {
        rendering: { kind: 'custom' },
        resourceTemplate: { resourceType: 'device' }
      }
    })

    expect(isMaterialListHandlingDraggable(unplaced)).toBe(true)
    expect(isMaterialListHandlingDraggable(detachedWithPosition)).toBe(true)
    expect(isMaterialListHandlingDraggable(occupied)).toBe(false)
    expect(isMaterialListHandlingDraggable(equipment)).toBe(false)
    expect(isMaterialListHandlingDraggable(backendBeaker)).toBe(true)
    expect(isMaterialListHandlingDraggable(backendDevice)).toBe(false)
  })

  it('transfers only the stable material id', () => {
    const setData = vi.fn()
    const dataTransfer: Pick<
      DataTransfer,
      'effectAllowed' | 'setData'
    > = {
      effectAllowed: 'none',
      setData
    }

    writeMaterialHandlingDragData(dataTransfer, 'beaker-500ml')

    expect(dataTransfer.effectAllowed).toBe('move')
    expect(setData).toHaveBeenCalledWith(
      MATERIAL_HANDLING_DRAG_TYPE,
      'beaker-500ml'
    )
    expect(readMaterialHandlingDragData({
      getData: () => 'beaker-500ml'
    })).toBe('beaker-500ml')
    expect(readMaterialHandlingDragData({
      getData: () => ' beaker-500ml '
    })).toBeNull()
  })
})
