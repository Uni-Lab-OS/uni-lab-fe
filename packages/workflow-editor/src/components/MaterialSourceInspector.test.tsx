import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type {
  MaterialSourceEditorProjection,
  MaterialSourceSelectorUpdate
} from '../utils/workflowMaterialSource'
import {
  filterMaterialSourceSites,
  MaterialSourceInspector
} from './PersistentWorkflowAuthoringPanel'

/**
 * 注册物料来源（MaterialSource）属性面板对公共物料图（MaterialGraph）目录顺序的行为测试。
 *
 * @returns 不返回值；渲染或过滤合同被破坏时由 Vitest 报告失败。
 */
function registerMaterialSourceInspectorTests(): void {
  it(
    '物料来源（MaterialSource）属性面板按公共物料图（MaterialGraph）顺序渲染闭合选择器',
    rendersClosedSelectorInPublicGraphOrder
  )
  it(
    '候选库位（Site）只按名称和稳定 UUID 过滤',
    filtersCandidateSitesByNameAndUuid
  )
}

describe(
  '物料来源（MaterialSource）属性面板',
  registerMaterialSourceInspectorTests
)

/**
 * 验证物料来源（MaterialSource）闭合选择器保留公共物料图（MaterialGraph）的库位（Site）目录顺序。
 *
 * @returns 不返回值；字段分组、状态或库位顺序不符时断言失败。
 */
function rendersClosedSelectorInPublicGraphOrder(): void {
  const markup = renderToStaticMarkup(
    <MaterialSourceInspector
      editor={editor()}
      editable
      status="material_waiting"
      diagnostics={[]}
      onChange={vi.fn(ignoreMaterialSourceChange)}
      onRevealSource={vi.fn()}
    />
  )

  expect(markup).toContain('物料来源属性')
  expect(markup).toContain('等待物料')
  expect(markup).toContain('物料角色')
  expect(markup).toContain('物料保管')
  expect(markup).toContain('任务全程独占')
  expect(markup).toContain('共享来源（动作期间互斥）')
  expect(markup).toContain('可让多个工作流任务同时绑定该来源')
  expect(markup).toContain('资源模板')
  expect(markup).toContain('在代码中打开资源模板')
  expect(markup).toContain('已有物料')
  expect(markup).toContain('新建物料')
  expect(markup).toContain('当前实验室 · 1 个兼容物料')
  expect(markup).toContain('384 Well Plate A · …000011')
  expect(markup).toContain('挂载点')
  expect(markup).toContain('库位范围')
  expect(markup).toContain('搜索候选库位')
  expect(markup).toContain('已选择 1 / 2')
  expect(markup.indexOf('库位 1')).toBeLessThan(markup.indexOf('库位 2'))
  expect(markup).not.toContain('Closure State')
  expect(markup).not.toContain('Comments')
  expect(markup).not.toContain('Content')
}

/**
 * 验证候选库位（Site）过滤只读取名称和稳定 UUID，不依赖伪业务顺序字段。
 *
 * @returns 不返回值；名称、UUID 或缺失查询的结果不符时断言失败。
 */
function filtersCandidateSitesByNameAndUuid(): void {
  const sites = editor().sites

  expect(filterMaterialSourceSites(sites, '库位 2')).toEqual([sites[1]])
  expect(filterMaterialSourceSites(sites, '000002')).toEqual([sites[1]])
  expect(filterMaterialSourceSites(sites, 'missing')).toEqual([])
}

/**
 * 接收属性面板测试中的物料来源（MaterialSource）补丁，不产生外部副作用。
 *
 * @param _patch 面板尝试提交的物料来源选择器补丁；静态渲染测试不会调用它。
 * @returns 不返回值。
 */
function ignoreMaterialSourceChange(
  _patch: Partial<MaterialSourceSelectorUpdate>
): void {
  void _patch
}

/**
 * 构造属性面板测试使用的物料来源（MaterialSource）编辑投影。
 *
 * @returns 含两个按公共物料图（MaterialGraph）顺序排列的候选库位（Site）的只读投影。
 */
function editor(): MaterialSourceEditorProjection {
  return {
    nodeUuid: '20000000-0000-4000-8000-000000000001',
    name: 'assay_plate',
    mode: 'existing',
    resourceTemplateUuid: '60000000-0000-4000-8000-000000000001',
    mountUuid: '50000000-0000-4000-8000-000000000001',
    fixedMaterialUuid: null,
    siteScope: 'candidates',
    fixedSiteUuid: null,
    candidateSiteUuids: ['70000000-0000-4000-8000-000000000001'],
    flowRole: 'primary_sample',
    custodyPolicy: 'shared_source',
    sharedSourceBlockedReason: null,
    resourceTemplates: [{
      uuid: '60000000-0000-4000-8000-000000000001',
      displayName: '384 Well Plate',
      sourceUri: 'package://catalog_lab/definitions.py'
    }],
    mounts: [{
      uuid: '50000000-0000-4000-8000-000000000001',
      name: 'Stacker A',
      resourceTemplateUuid: '60000000-0000-4000-8000-000000000099',
      materialClass: 'Stacker'
    }],
    fixedMaterials: [{
      uuid: '80000000-0000-4000-8000-000000000011',
      name: '384 Well Plate A',
      resourceTemplateUuid: '60000000-0000-4000-8000-000000000001'
    }],
    sites: [
      {
        uuid: '70000000-0000-4000-8000-000000000001',
        name: '库位 1',
        sortOrder: 1,
        mountMaterialUuid: '50000000-0000-4000-8000-000000000001',
        allowedResourceTemplateUuids: [
          '60000000-0000-4000-8000-000000000001'
        ],
        occupiedMaterialUuid: null
      },
      {
        uuid: '70000000-0000-4000-8000-000000000002',
        name: '库位 2',
        sortOrder: 2,
        mountMaterialUuid: '50000000-0000-4000-8000-000000000001',
        allowedResourceTemplateUuids: [],
        occupiedMaterialUuid: null
      }
    ],
    staleReferences: []
  }
}
