import { describe, expect, it } from 'vitest'

import {
  formatMaterialConfigField,
  parseMaterialNumber,
  parseMaterialNumberList,
  projectMaterialConfig,
  setMaterialConfigValue
} from './materialConfigEditor'

describe('materialConfigEditor', () => {
  /** 证明常用标量与数值列表进入表单，复杂对象只进入高级配置摘要。 */
  it('projects safe fields and keeps structured values advanced', () => {
    const projection = projectMaterialConfig({
      batch: 'B-42',
      rows: 4,
      enabled: true,
      dimensionsMm: [127.8, 85.5, 14.4],
      rendering: { kind: 'plate' }
    })

    expect(projection.fields.map((field) => [field.key, field.kind])).toEqual([
      ['batch', 'text'],
      ['rows', 'number'],
      ['enabled', 'boolean'],
      ['dimensionsMm', 'number-list']
    ])
    expect(projection.advancedItems).toEqual([
      {
        key: 'rendering',
        label: '渲染配置',
        summary: '对象 · 1 项'
      }
    ])
  })

  /** 证明模板 Schema 可以为尚未设置的常用字段提供中文说明与整数约束。 */
  it('uses template schema metadata without inventing config values', () => {
    const projection = projectMaterialConfig(
      {},
      {
        type: 'object',
        required: ['rows'],
        properties: {
          rows: {
            type: 'integer',
            title: '托盘行数',
            description: '当前物料实例的行数'
          }
        }
      }
    )

    expect(projection.fields[0]).toMatchObject({
      key: 'rows',
      label: '托盘行数',
      description: '当前物料实例的行数',
      kind: 'number',
      required: true,
      integer: true,
      present: false,
      value: undefined
    })
  })

  /** 证明数字和中文逗号列表校验拒绝非法输入并保留准确值。 */
  it('parses constrained numbers and number lists', () => {
    expect(parseMaterialNumber('4', true)).toEqual({ valid: true, value: 4 })
    expect(parseMaterialNumber('4.2', true)).toMatchObject({ valid: false })
    expect(parseMaterialNumberList('127.8，85.5, 14.4', false)).toEqual({
      valid: true,
      value: [127.8, 85.5, 14.4]
    })
    expect(parseMaterialNumberList('10, wrong', false)).toMatchObject({
      valid: false
    })
  })

  /** 证明字段更新不修改原配置，undefined 只移除目标可选字段。 */
  it('updates the shared config draft immutably', () => {
    const current = { batch: 'B-1', rows: 4 }
    expect(setMaterialConfigValue(current, 'rows', 6)).toEqual({
      batch: 'B-1',
      rows: 6
    })
    expect(setMaterialConfigValue(current, 'batch', undefined)).toEqual({
      rows: 4
    })
    expect(current).toEqual({ batch: 'B-1', rows: 4 })
  })

  /** 证明数值列表字段以非代码用户可读的逗号文本显示。 */
  it('formats number lists for direct editing', () => {
    const field = projectMaterialConfig({ dimensionsMm: [1, 2, 3] }).fields[0]
    expect(field && formatMaterialConfigField(field)).toBe('1, 2, 3')
  })
})
