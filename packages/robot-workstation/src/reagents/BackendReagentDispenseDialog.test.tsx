import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  BackendReagentDispenseDialog,
  validateReagentDispense
} from './BackendReagentDispenseDialog'

describe('Backend reagent dispense dialog', () => {
  const base = {
    commandId: 'dispense-command-1',
    sourceReagentId: 'reagent-1',
    sourceMaterialId: 'source-bottle',
    expectedRevision: 3,
    quantityUnit: 'mL',
    availableQuantity: 80,
    targets: [
      { materialId: 'target-1', quantity: 20 },
      { materialId: 'target-2', quantity: 30 }
    ]
  }

  it('validates target uniqueness and available quantity conservation', () => {
    expect(validateReagentDispense(base)).toBeNull()
    expect(validateReagentDispense({
      ...base,
      targets: [
        { materialId: 'target-1', quantity: 20 },
        { materialId: 'target-1', quantity: 30 }
      ]
    })).toBe('分装目标容器不能重复')
    expect(validateReagentDispense({
      ...base,
      targets: [{ materialId: 'target-1', quantity: 81 }]
    })).toBe('分装总量不能超过可用数量 80 mL')
    expect(validateReagentDispense({
      ...base,
      targets: [{ materialId: 'source-bottle', quantity: 10 }]
    })).toBe('目标容器不能与源容器相同')
  })

  it('renders source quantities and only empty target containers', () => {
    const markup = renderToStaticMarkup(createElement(BackendReagentDispenseDialog, {
      item: {
        id: 'reagent-1',
        materialId: 'source-bottle',
        name: '乙醇',
        totalQuantity: 100,
        availableQuantity: 80,
        reservedQuantity: 20,
        unit: 'mL',
        revision: 3,
        status: 'reserved'
      },
      containers: [
        { id: 'source-bottle', name: '源瓶', templateId: 'bottle' },
        { id: 'empty-bottle', name: '空目标瓶', barcode: 'EMPTY-01', templateId: 'bottle' },
        { id: 'occupied-bottle', name: '已占用瓶', barcode: 'USED-01', templateId: 'bottle' }
      ],
      occupiedMaterialIds: new Set(['source-bottle', 'occupied-bottle']),
      onSave: async () => undefined,
      onClose: () => undefined
    }))

    expect(markup).toContain('分装试剂 · 乙醇')
    expect(markup).toContain('可分装')
    expect(markup).toContain('80 mL')
    expect(markup).toContain('预留中')
    expect(markup).toContain('20 mL')
    expect(markup).toContain('空目标瓶')
    expect(markup).not.toContain('已占用瓶')
    expect(markup).toContain('添加目标容器')
    expect(markup).toContain('确认分装')
  })
})
