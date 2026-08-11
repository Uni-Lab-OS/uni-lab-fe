import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { MaterialWorkspaceProjection } from '@unilab/material'
import {
  nextReagentCustomFieldKey,
  normalizeReagentCustomFields,
  validateReagentCustomFields
} from './ReagentCustomFields'
import { ReagentHistoryPanel } from './ReagentHistoryPanel'
import { ReagentWorkspace } from './ReagentWorkspace'
import {
  projectReagentCatalog,
  isNonReagentResourceTemplate,
  isReagentResourceTemplate,
  reagentHistoryForInfo,
  reagentContainerAttentionReasons,
  resolveReagentExpiryState,
  resolveReagentCapabilities,
  type ReagentHistoryEvent,
  type ReagentWorkspaceSnapshot
} from './reagentWorkspace'

const projection: MaterialWorkspaceProjection = {
  summary: {
    graphNodeCount: 2,
    resourceTemplateCount: 1,
    batchGroupCount: 1,
    physicalSiteCount: 1,
    occupiedPhysicalSiteCount: 1,
    batchCoveredCount: 1,
    trackedInstanceCount: 1,
    placedInstanceCount: 1,
    unbatchedInstanceCount: 0
  },
  templates: [],
  lotGroups: [],
  rows: [{
    id: 'material-pbs-01',
    name: 'PBS #01',
    code: 'PBS_01',
    templateId: 'template-reagent-bottle',
    templateName: '试剂瓶',
    batch: 'PBS-01',
    placementLabel: '冷藏柜 / A1',
    placed: true,
    physicalSiteCount: 0,
    internalContainerCount: 0,
    revision: 1,
    updatedAt: '2026-08-09T00:00:00Z'
  }]
}

const snapshot: ReagentWorkspaceSnapshot = {
  revision: 'test-1',
  reagentInfos: [{
    id: 'info-pbs',
    name: 'PBS',
    aliases: [],
    physicalState: '液体',
    hazardLabels: []
  }],
  lots: [{
    id: 'lot-pbs-01',
    reagentInfoId: 'info-pbs',
    code: 'PBS-01',
    qualityState: 'released'
  }],
  containers: [{
    materialId: 'material-pbs-01',
    reagentInfoId: 'info-pbs',
    lotId: 'lot-pbs-01',
    quantity: { value: 20, unit: 'mL' },
    initialQuantity: { value: 50, unit: 'mL' },
    state: 'opened'
  }, {
    materialId: 'missing-material',
    reagentInfoId: 'info-pbs',
    lotId: 'lot-pbs-01',
    quantity: { value: 1, unit: 'L' },
    initialQuantity: { value: 1, unit: 'L' },
    state: 'sealed'
  }],
  history: []
}

describe('projectReagentCatalog', () => {
  /** 统一台账只保留一个容器表，以筛选代替重复的试剂与存储视图。 */
  it('将试剂与库位查询合并到同一张容器台账', () => {
    const html = renderToStaticMarkup(createElement(ReagentWorkspace, {
      projection
    }))

    expect(html).toContain('试剂台账')
    expect(html).toContain('容器台账')
    expect(html).toContain('按试剂筛选')
    expect(html).toContain('按库位筛选')
    expect(html).toContain('＋ 新建试剂')
    expect(html).not.toContain('试剂台账视图')
    expect(html).not.toContain('按存储查看')
    expect(html).not.toContain('当前存储')
    expect(html).not.toContain('reagent-workspace__sections')
  })

  /** 稳定目录字段只做模块展示分区，不要求在全局 Material 上固化试剂角色。 */
  it('只按显式目录字段分离物料与试剂模块', () => {
    const template = {
      uuid: 'template-reagent',
      key: 'reagent-bottle',
      sourceNamespace: 'fixture',
      kind: 'resource' as const,
      displayName: '试剂瓶',
      tags: ['试剂', '容器'],
      categoryPath: ['试剂', '试剂容器'],
      catalogSection: 'reagent' as const,
      status: 'ready' as const,
      contentHash: 'fixture-reagent',
      creation: { mode: 'resource-tree' as const, available: true }
    }

    expect(isReagentResourceTemplate(template)).toBe(true)
    expect(isNonReagentResourceTemplate(template)).toBe(false)
    expect(isNonReagentResourceTemplate({
      ...template,
      key: 'pcr-plate',
      displayName: 'PCR 板',
      tags: ['耗材'],
      categoryPath: ['耗材', '反应板'],
      catalogSection: 'material'
    })).toBe(true)
    expect(isReagentResourceTemplate({
      ...template,
      key: 'composite-container',
      tags: ['危险化学试剂容器'],
      categoryPath: ['实验室用品'],
      catalogSection: undefined
    })).toBe(false)
    expect(isReagentResourceTemplate({
      ...template,
      key: 'reagent-rack',
      displayName: '普通耗材架',
      tags: ['耗材'],
      categoryPath: ['耗材'],
      catalogSection: 'material'
    })).toBe(false)
  })

  /** 只连接能够解析到唯一 Material 实例的专属试剂数量投影。 */
  it('排除缺失 Material 身份的容器且保留当前位置', () => {
    const [group] = projectReagentCatalog(projection, snapshot, {
      includeInventory: true
    })

    expect(group?.containers).toHaveLength(1)
    expect(group?.containers[0]?.material.placementLabel).toBe('冷藏柜 / A1')
    expect(group?.containers[0]?.remainingRatio).toBe(0.4)
    expect(group?.totalRemaining).toEqual({ value: 20, unit: 'mL' })
  })

  /** 缺少专属试剂投影时保持空目录，不从通用物料配置推断试剂库存。 */
  it('在专属投影缺失时失败关闭', () => {
    expect(projectReagentCatalog(projection)).toEqual([])
    expect(resolveReagentCapabilities().readCatalog.available).toBe(false)
    expect(resolveReagentCapabilities().readInventory.available).toBe(false)
  })

  /** 目录可读但数量库存不可读时保留试剂和批次，不泄露容器余量。 */
  it('在库存能力缺失时只投影试剂信息与批次', () => {
    const [group] = projectReagentCatalog(projection, snapshot, {
      includeInventory: false
    })

    expect(group?.reagentInfo.name).toBe('PBS')
    expect(group?.lots).toHaveLength(1)
    expect(group?.containers).toEqual([])
    expect(group?.totalRemaining).toBeNull()
  })

  /** 批次待检与临期记录进入人工关注提示，但不被解释为任务可用性。 */
  it('汇总批次质量和有效期关注原因', () => {
    const [group] = projectReagentCatalog(projection, {
      ...snapshot,
      lots: [{
        ...snapshot.lots[0],
        qualityState: 'pending',
        expiresAt: '2026-08-20'
      }]
    }, { includeInventory: true })
    const container = group?.containers[0]

    expect(container).toBeDefined()
    expect(reagentContainerAttentionReasons(
      container!,
      new Date('2026-08-09T00:00:00Z').valueOf()
    )).toEqual(['批次待质检', '三十天内到期'])
    expect(resolveReagentExpiryState(
      '2026-08-08',
      new Date('2026-08-09T00:00:00Z').valueOf()
    )).toBe('expired')
    expect(resolveReagentExpiryState(
      '2026-08-09',
      new Date('2026-08-09T12:00:00').valueOf()
    )).toBe('expiring')
  })

  /** 详情履历只使用稳定试剂信息身份关联，不混入其他试剂事件。 */
  it('在具体试剂详情中只展示该试剂的历史', () => {
    const events: ReagentHistoryEvent[] = [{
      id: 'history-1',
      materialId: 'material-pbs-01',
      materialName: 'PBS #01',
      reagentInfoId: 'info-pbs',
      lotId: 'lot-pbs-01',
      occurredAt: '2026-08-09T09:00:00Z',
      eventType: 'opened',
      operator: '测试员',
      detail: '首次开启'
    }, {
      id: 'history-other',
      materialId: 'material-dmso-01',
      materialName: 'DMSO #01',
      reagentInfoId: 'info-dmso',
      occurredAt: '2026-08-09T10:00:00Z',
      eventType: 'adjusted',
      operator: '其他测试员',
      detail: '其他试剂库存调整'
    }]
    const markup = renderToStaticMarkup(createElement(ReagentHistoryPanel, {
      reagentInfo: snapshot.reagentInfos[0]!,
      events,
      readStatus: { available: true }
    }))

    expect(reagentHistoryForInfo(events, 'info-pbs')).toHaveLength(1)
    expect(markup).toContain('PBS #01')
    expect(markup).toContain('首次开启')
    expect(markup).not.toContain('其他试剂库存调整')
  })
})

describe('试剂自定义字段', () => {
  /** 新字段身份由系统生成，且不会覆盖已有稳定字段键。 */
  it('生成当前试剂内唯一的稳定字段键', () => {
    expect(nextReagentCustomFieldKey([
      { key: 'custom_field_1', label: '纯度', value: '99.5', unit: '%' },
      { key: 'supplier_grade', label: '供应商等级', value: '分析纯' }
    ])).toBe('custom_field_2')
  })

  /** 名称和值是可保存自定义字段的最小结构，重复名称必须阻止提交。 */
  it('拒绝空值和重复显示名称', () => {
    expect(validateReagentCustomFields([
      { key: 'field_a', label: '纯度', value: '99.5' },
      { key: 'field_b', label: '纯度', value: '分析纯' }
    ])).toContain('不能重复')
    expect(validateReagentCustomFields([
      { key: 'field_a', label: '纯度', value: '' }
    ])).toContain('字段值')
  })

  /** 写端口接收修剪后的字段内容，同时保留不可见的稳定键。 */
  it('规范化字段名称、值和可选单位', () => {
    expect(normalizeReagentCustomFields([{
      key: 'purity',
      label: ' 纯度 ',
      value: ' 99.5 ',
      unit: ' % '
    }])).toEqual([{
      key: 'purity',
      label: '纯度',
      value: '99.5',
      unit: '%'
    }])
  })
})
