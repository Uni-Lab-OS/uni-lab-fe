import { useEffect, useMemo, useState } from 'react'
import type {
  MaterialId,
  MaterialWorkspaceProjection
} from '@unilab/material'

import { ReagentCreateView } from './ReagentCreateView'
import { ReagentCatalogView } from './ReagentCatalogView'
import { reagentScopeClassName } from './reagentStyles'
import {
  projectReagentCatalog,
  resolveReagentCapabilities,
  type ReagentWorkspaceIntegration,
  type ReagentWorkspaceSection
} from './reagentWorkspace'

/**
 * THESIS: 试剂是一等实验室业务模块；它引用 Material 容器事实，但不隐藏在物料管理导航中。
 * OWN-WORLD: 以试剂青为模块身份，用冷灰背景、平整白色表面与状态文字组织高密度信息。
 * STORY: 用户创建试剂信息与容器，在统一台账中筛选容器、核对数量与库位，并在所选试剂详情中维护信息和追溯履历。
 * FIRST VIEWPORT: 紧凑摘要和主操作保持在顶部，主体以统一容器表—关联试剂详情的连续工作区展开。
 * FORM: 应用一级导航中的独立专业工作区，不建立第二套物料、库存或运行状态模型。
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
 */

export interface ReagentWorkspaceProps {
  projection: MaterialWorkspaceProjection
  integration?: ReagentWorkspaceIntegration
  selectedMaterialIds?: readonly MaterialId[]
  onSelectionChange?: (materialIds: readonly MaterialId[]) => void
}

/**
 * 组合统一试剂台账、试剂创建、信息维护和关联履历工作区。
 * @param props 唯一物料投影、专属试剂投影、能力边界与跨面板选择回调。
 * @returns 共享 Material 身份但不推断库存或执行状态的试剂模块。
 */
export function ReagentWorkspace({
  projection,
  integration,
  selectedMaterialIds = [],
  onSelectionChange
}: ReagentWorkspaceProps): React.JSX.Element {
  const [activeSection, setActiveSection] =
    useState<ReagentWorkspaceSection>('ledger')
  const capabilities = useMemo(
    () => resolveReagentCapabilities(integration?.capabilities),
    [integration?.capabilities]
  )
  const groups = useMemo(
    () => capabilities.readCatalog.available
      ? projectReagentCatalog(projection, integration?.snapshot, {
          includeInventory: capabilities.readInventory.available
        })
      : [],
    [
      capabilities.readCatalog.available,
      capabilities.readInventory.available,
      integration?.snapshot,
      projection
    ]
  )
  const trackedContainers = groups.flatMap((group) => group.containers)
  const selectedContainer = trackedContainers.find((container) =>
    selectedMaterialIds.includes(container.materialId)
  ) ?? trackedContainers[0] ?? null
  const selectedInfoId = selectedContainer?.reagentInfoId ??
    groups[0]?.reagentInfo.id ?? null

  useEffect(() => {
    if (selectedMaterialIds.length || !selectedContainer) return
    onSelectionChange?.([selectedContainer.materialId])
  }, [onSelectionChange, selectedContainer, selectedMaterialIds.length])

  /**
   * 在统一试剂台账与新建试剂任务页之间切换。
   * @param section 用户进入的试剂工作区页面。
   * @returns 无返回值；不触发库存、预留或占用写入。
   */
  const changeSection = (section: ReagentWorkspaceSection): void => {
    setActiveSection(section)
  }

  /**
   * 将统一台账中的容器选择发布给共享物料工作台。
   * @param materialId 已由目录投影解析的稳定 Material 身份。
   * @returns 无返回值；只发布选择，不更改物料或库位。
   */
  const selectContainer = (materialId: MaterialId): void => {
    onSelectionChange?.([materialId])
  }

  return (
    <section
      id="reagent-workspace"
      className={reagentScopeClassName('reagent-workspace')}
      aria-labelledby="reagent-workspace-title"
    >
      <header className="reagent-workspace__header">
        <div>
          <h2 id="reagent-workspace-title">试剂台账</h2>
          <p>在同一张容器台账中查询试剂、批次、数量与库位，并查看关联履历。</p>
        </div>
        <dl aria-label="试剂管理摘要">
          <div><dt>试剂信息</dt><dd>{capabilities.readCatalog.available
            ? groups.length
            : '—'}</dd></div>
          <div><dt>批次</dt><dd>{capabilities.readCatalog.available
            ? groups.reduce(
            (count, group) => count + group.lots.length,
            0
          )
            : '—'}</dd></div>
          <div><dt>容器实例</dt><dd>{capabilities.readInventory.available
            ? trackedContainers.length
            : '—'}</dd></div>
          <div><dt>已放置</dt><dd>{capabilities.readInventory.available
            ? trackedContainers.filter(
            (container) => container.material.placed
          ).length
            : '—'}</dd></div>
        </dl>
      </header>

      <div className="reagent-workspace__content">
        {activeSection === 'ledger' ? (
          <ReagentCatalogView
            groups={groups}
            selectedInfoId={selectedInfoId}
            selectedMaterialIds={selectedMaterialIds}
            readStatus={capabilities.readCatalog}
            inventoryStatus={capabilities.readInventory}
            updateStatus={capabilities.updateInfo}
            historyStatus={capabilities.readHistory}
            historyEvents={integration?.snapshot?.history ?? []}
            onSelectContainer={selectContainer}
            onRequestCreate={() => changeSection('create')}
            onUpdateInfo={integration?.onUpdateInfo}
          />
        ) : (
          <ReagentCreateView
            createStatus={capabilities.create}
            onCancel={() => changeSection('ledger')}
            onCreate={integration?.onCreate}
          />
        )}
      </div>
    </section>
  )
}
