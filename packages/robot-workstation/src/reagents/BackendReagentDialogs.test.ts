import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  BackendReagentEditorDialog,
  filterReagentContainers,
  validateReagentEditor
} from './BackendReagentDialogs'

describe('Backend reagent editor validation', () => {
  /** 证明创建必须使用校验位正确的 CAS，避免向外部化合物查询发送明显无效身份。 */
  it('validates the CAS checksum for Backend creation', () => {
    const base = {
      materialId: 'material-1',
      cas: '64-17-5',
      physicalState: 'liquid' as const,
      quantity: 100,
      quantityUnit: 'mL'
    }

    expect(validateReagentEditor(base, 'create')).toBeNull()
    expect(validateReagentEditor({ ...base, cas: '64-17-6' }, 'create')).toBe(
      '请输入校验位正确的 CAS 号'
    )
    expect(validateReagentEditor({ ...base, reagentInfoId: '' }, 'create')).toBe(
      '请选择试剂身份'
    )
    expect(validateReagentEditor({ ...base, quantityUnit: 'mol' }, 'create')).toBe(
      '请选择 Backend 支持的计量单位'
    )
  })

  /** 证明浓度值和单位必须成对提交，且库存数量不能为负。 */
  it('rejects partial concentration and negative quantity', () => {
    const base = {
      materialId: 'material-1',
      cas: '64-17-5',
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

  /** 创建窗口要求用户显式选择尚未承载试剂的空容器物料。 */
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
            id: 'info-ethanol',
            name: '乙醇',
            aliases: [],
            cas: '64-17-5',
            physicalState: 'liquid',
            densityGPerMl: 0.786
          }
        ],
        occupiedMaterialIds: new Set(['occupied-1']),
        onSave: async () => {},
        onClose: () => {}
      })
    )

    expect(markup).toContain('空容器物料')
    expect(markup).toContain('请选择空容器物料')
    expect(markup).toContain('搜索名称、条码或 UUID')
    expect(markup).toContain('role="combobox"')
    expect(markup).toContain('role="listbox"')
    expect(markup).toContain('空试剂瓶')
    expect(markup).toContain('BOT-001')
    expect(markup).not.toContain('已用试剂瓶')
    expect(markup).toContain('试剂身份')
    expect(markup).toContain('乙醇')
    expect(markup).toContain('64-17-5')
    expect(markup).toContain('请选择试剂身份')
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
