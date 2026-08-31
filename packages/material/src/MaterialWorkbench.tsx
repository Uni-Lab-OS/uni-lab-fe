import { useMemo, useState, type ReactNode } from 'react'

import type { CapabilityStatus } from './MaterialCapabilityNotice'
import { MaterialInspector } from './MaterialInspector'
import {
  useMaterialStore,
  useMaterialStoreApi
} from './MaterialStoreProvider'
import { MaterialTemplateLauncher } from './MaterialTemplateLauncher'
import { MaterialTreeSidebar } from './MaterialTreeSidebar'
import { materialScopeClassName } from './materialStyles'
import {
  MaterialCanvas,
  type MaterialFocusRequest
} from './react-flow/MaterialCanvas'
import type { MaterialTemplateCatalogPort } from './templateMaterial'
import type { MaterialId, MaterialScope } from './types'

export interface MaterialWorkbenchCapabilities {
  readTemplates: CapabilityStatus
  readGraph: CapabilityStatus
  create: CapabilityStatus
  updateConfig: CapabilityStatus
  move: CapabilityStatus
  attach: CapabilityStatus
  detach: CapabilityStatus
}

export interface MaterialWorkbenchProps {
  catalog: MaterialTemplateCatalogPort
  profileId: string
  scope: MaterialScope
  capabilities: MaterialWorkbenchCapabilities
  selectedMaterialIds?: readonly MaterialId[]
  highlightedMaterialIds?: readonly MaterialId[]
  onSelectionChange?: (materialIds: readonly MaterialId[]) => void
  renderViewport?: (props: MaterialWorkbenchViewportProps) => ReactNode
}

export interface MaterialWorkbenchViewportProps {
  readStatus: CapabilityStatus
  moveStatus: CapabilityStatus
  attachStatus: CapabilityStatus
  detachStatus: CapabilityStatus
  focusRequest: MaterialFocusRequest | null
  selectedMaterialIds: readonly MaterialId[]
  highlightedMaterialIds: readonly MaterialId[]
  onSelectionChange?: (materialIds: readonly MaterialId[]) => void
}

/**
 * The Material package composes its own catalog, 2D projection and inspector.
 * Application-specific Services/Profile and cross-panel stores stay injected.
 */
export function MaterialWorkbench({
  catalog,
  profileId,
  scope,
  capabilities,
  selectedMaterialIds = [],
  highlightedMaterialIds = [],
  onSelectionChange,
  renderViewport
}: MaterialWorkbenchProps): React.JSX.Element {
  const [focusRequest, setFocusRequest] = useState<MaterialFocusRequest | null>(
    null
  )
  const store = useMaterialStoreApi()
  const aggregatesById = useMaterialStore(
    (state) => state.aggregatesById
  )
  const existingNames = useMemo(
    () =>
      Object.values(aggregatesById)
        .filter(
          (aggregate) =>
            aggregate.material.component?.managedByParent !== true
        )
        .map((aggregate) => aggregate.material.name),
    [aggregatesById]
  )
  const inspectedMaterialId = selectedMaterialIds[0] ?? null

  return (
    <div className={materialScopeClassName('material-workbench')}>
      <MaterialTreeSidebar
        selectedMaterialIds={selectedMaterialIds}
        onSelectionChange={onSelectionChange}
        onMaterialActivate={(materialId) => {
          setFocusRequest((current) => ({
            materialId,
            revision: (current?.revision ?? 0) + 1
          }))
        }}
      />
      <div className="material-workbench__viewport">
        {renderViewport ? (
          renderViewport({
            readStatus: capabilities.readGraph,
            moveStatus: capabilities.move,
            attachStatus: capabilities.attach,
            detachStatus: capabilities.detach,
            focusRequest,
            selectedMaterialIds,
            highlightedMaterialIds,
            onSelectionChange
          })
        ) : (
          <MaterialCanvas
            readStatus={capabilities.readGraph}
            moveStatus={capabilities.move}
            attachStatus={capabilities.attach}
            detachStatus={capabilities.detach}
            focusRequest={focusRequest}
            selectedMaterialIds={selectedMaterialIds}
            highlightedMaterialIds={highlightedMaterialIds}
            onSelectionChange={onSelectionChange}
          />
        )}
      </div>
      <MaterialTemplateLauncher
        catalog={catalog}
        profileId={profileId}
        scope={scope}
        readStatus={capabilities.readTemplates}
        createStatus={capabilities.create}
        existingNames={existingNames}
        onCreate={async (_template, draft) => {
          await store.getState().createMaterial(draft.createInput)
        }}
      />
      <MaterialInspector
        materialId={inspectedMaterialId}
        updateStatus={capabilities.updateConfig}
        onClose={() => onSelectionChange?.([])}
      />
    </div>
  )
}
