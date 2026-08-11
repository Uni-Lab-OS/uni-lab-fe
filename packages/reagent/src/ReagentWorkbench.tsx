import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import {
  projectMaterialWorkspace,
  useMaterialStore,
  useMaterialStoreApi,
  type MaterialId,
  type MaterialScope,
  type MaterialTemplateCatalogPort
} from '@unilab/material'

import { ReagentWorkspace } from './ReagentWorkspace'
import type {
  CapabilityStatus,
  ReagentWorkspaceIntegration
} from './reagentWorkspace'
import { isReagentResourceTemplate } from './reagentWorkspace'

export interface ReagentWorkbenchCapabilities {
  readTemplates: CapabilityStatus
  readGraph: CapabilityStatus
}

export interface ReagentWorkbenchProps {
  catalog: MaterialTemplateCatalogPort
  profileId: string
  scope: MaterialScope
  capabilities: ReagentWorkbenchCapabilities
  integration?: ReagentWorkspaceIntegration
  selectedMaterialIds?: readonly MaterialId[]
  onSelectionChange?: (materialIds: readonly MaterialId[]) => void
}

/**
 * 从共享物料图构造独立试剂模块需要的只读容器与库位投影。
 * @param props 物料目录端口、作用域、读取能力、试剂专用端口和选择回调。
 * @returns 与物料模块同级、但复用 Material 与 Site 权威事实的试剂工作台。
 */
export function ReagentWorkbench({
  catalog,
  profileId,
  scope,
  capabilities,
  integration,
  selectedMaterialIds = [],
  onSelectionChange
}: ReagentWorkbenchProps): React.JSX.Element {
  const store = useMaterialStoreApi()
  const aggregatesById = useMaterialStore((state) => state.aggregatesById)
  const loadState = useMaterialStore((state) => state.loadState)
  const scopeKey = scope.kind === 'singleton' ? 'singleton' : scope.laboratoryId
  const templateCatalog = useQuery({
    queryKey: ['reagent-material-templates', profileId, scopeKey],
    queryFn: () => catalog.listTemplates(scope),
    enabled: capabilities.readTemplates.available
  })
  const projection = useMemo(
    () => projectMaterialWorkspace(
      aggregatesById,
      (templateCatalog.data?.items ?? []).filter(isReagentResourceTemplate)
    ),
    [aggregatesById, templateCatalog.data?.items]
  )

  useEffect(() => {
    if (!capabilities.readGraph.available || loadState !== 'idle') return
    void store.getState().loadGraph().catch(() => undefined)
  }, [capabilities.readGraph.available, loadState, store])

  return (
    <ReagentWorkspace
      projection={projection}
      integration={integration}
      selectedMaterialIds={selectedMaterialIds}
      onSelectionChange={onSelectionChange}
    />
  )
}
