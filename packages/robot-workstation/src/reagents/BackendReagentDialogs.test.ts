import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  BackendReagentEditorDialog,
  filterReagentContainers,
  reagentCreateCommand,
  validateReagentEditor
} from './BackendReagentDialogs'

describe('Backend reagent editor validation', () => {
  /** 证明既有 UUID 目录项没有 CAS 时仍可办理试剂入库。 */
  it('accepts a selected reagent identity without CAS', () => {
    const base = {
      materialId: 'material-1',
      reagentInfoId: '11111111-1111-4111-8111-111111111111',
      physicalState: 'unknown' as const,
      quantity: 1,
      quantityUnit: 'g'
    }

    expect(validateReagentEditor(base, 'create')).toBeNull()
    expect(validateReagentEditor({ ...base, reagentInfoId: '' }, 'create')).toBe(
      '请选择试剂名称'
    )
    expect(validateReagentEditor({ ...base, quantityUnit: 'mol' }, 'create')).toBe(
      '请选择 Backend 支持的计量单位'
    )
  })

  /** 证明浓度值和单位必须成对提交，且库存数量不能为负。 */
  it('rejects partial concentration and negative quantity', () => {
    const base = {
      materialId: 'material-1',
      reagentInfoId: '11111111-1111-4111-8111-111111111111',
      physicalState: 'liquid' as const,
      quantity: 100,
      quantityUnit: 'mL'
    }

    expect(validateReagentEditor({
      ...base,
      concentrationValue: 95
    }, 'create')).toBe('浓度数值和单位必须同时填写或同时留空')
    expect(validateReagentEditor({ ...base, quantity: -1 }, 'edit')).toBe(
      '数量必须是大于等于零的有限数'
    )
  })

  /** 创建窗口要求用户显式选择尚未承载试剂的试剂容器。 */
  it('renders an explicit empty-container material selector', () => {
    const markup = renderToStaticMarkup(
      createElement(BackendReagentEditorDialog, {
        mode: 'create',
        containers: [
          { id: 'empty-1', name: '空试剂瓶', barcode: 'BOT-001', templateId: 'container-1' },
          { id: 'occupied-1', name: '已用试剂瓶', barcode: 'BOT-002', templateId: 'container-1' }
        ],
        infos: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'demo-1',
            aliases: [],
            physicalState: 'unknown'
          }
        ],
        occupiedMaterialIds: new Set(['occupied-1']),
        onSave: async () => {},
        onClose: () => {}
      })
    )

    expect(markup).toContain('试剂容器')
    expect(markup).toContain('请选择试剂容器')
    expect(markup).toContain('搜索名称、条码或 UUID')
    expect(markup).toContain('role="combobox"')
    expect(markup).toContain('role="listbox"')
    expect(markup).toContain('空试剂瓶')
    expect(markup).toContain('BOT-001')
    expect(markup).not.toContain('已用试剂瓶')
    expect(markup).toContain('试剂名称')
    expect(markup).toContain('demo-1')
    expect(markup).toContain('请选择试剂名称')
    expect(markup).toContain('name="reagentInfoId"')
    expect(markup).not.toContain('name="cas"')
    expect(markup).toContain('密度（g/mL）')
    expect(markup).not.toContain('密度条件')
    expect(markup).toContain('供应商')
    expect(markup).toContain('有效期')
    expect(markup).toContain('更多信息')
    expect(markup).toContain('添加自定义参数')
    expect(markup).not.toContain('暂无自定义参数')
    expect(markup).toContain('aria-label="计量单位"')
    expect(markup).toContain('aria-label="体积"')
    expect(markup).toContain('aria-label="质量"')
    for (const unit of ['µL', 'mL', 'L', 'mg', 'g', 'kg']) {
      expect(markup).toContain(`>${unit}<`)
    }
    expect(markup).not.toContain('mol</')
    expect(markup).not.toMatch(/name="quantityUnit"[^>]*value="mL"/)
    expect(markup).not.toMatch(/name="expiresOn"[^>]*value=/)
  })

  /** 证明试剂入库登记窗口采用“试剂与容器 / 试剂容器 / 试剂名称”术语。 */
  it('uses the requested reagent stock-in terminology', () => {
    const markup = renderToStaticMarkup(
      createElement(BackendReagentEditorDialog, {
        mode: 'create',
        containers: [
          { id: 'empty-1', name: '试剂瓶', barcode: 'BOT-001', templateId: 'container-1' }
        ],
        infos: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: '乙醇',
            aliases: [],
            physicalState: 'liquid'
          }
        ],
        occupiedMaterialIds: new Set<string>(),
        onSave: async () => undefined,
        onClose: () => undefined
      })
    )

    expect(markup).toContain('试剂入库登记')
    expect(markup).toContain('<legend>试剂与容器</legend>')
    expect(markup).toContain('试剂容器')
    expect(markup).toContain('试剂名称')
    expect(markup).not.toContain('登记库存试剂')
    expect(markup).not.toContain('<legend>身份与容器</legend>')
  })

  /** 证明表单命令保留身份 UUID，不再退化或复制为 CAS。 */
  it('passes reagentInfoId through the create command', () => {
    const command = reagentCreateCommand({
      materialId: 'material-1',
      reagentInfoId: '11111111-1111-4111-8111-111111111111',
      physicalState: 'unknown',
      quantity: 1,
      quantityUnit: 'g'
    }, [])

    expect(command).toMatchObject({
      materialId: 'material-1',
      reagentInfoId: '11111111-1111-4111-8111-111111111111',
      quantity: 1,
      quantityUnit: 'g'
    })
    expect(command).not.toHaveProperty('cas')
  })

  it('按物料名称、条码和 UUID 搜索空容器', () => {
    const containers = [
      { id: 'material-alpha', name: '空试剂瓶', barcode: 'BOT-001', templateId: 'container-1' },
      { id: 'material-beta', name: '烧杯', barcode: 'BEAKER-02', templateId: 'container-2' }
    ]

    expect(filterReagentContainers(containers, '试剂')).toEqual([containers[0]])
    expect(filterReagentContainers(containers, 'beaker-02')).toEqual([containers[1]])
    expect(filterReagentContainers(containers, 'MATERIAL-ALPHA')).toEqual([containers[0]])
    expect(filterReagentContainers(containers, '  ')).toEqual(containers)
  })
})
