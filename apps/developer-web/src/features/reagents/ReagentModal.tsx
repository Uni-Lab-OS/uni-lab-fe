import type { ReagentInfo } from '@unilab-fe/core'
import { CatalogDetail as ReagentCatalogDetail } from './ReagentCatalogDetail'
import { DispenseModal as ReagentDispenseModal } from './ReagentDispenseModal'
import { HistoryModal as ReagentHistoryModal } from './ReagentHistoryModal'
import { ImportModal as ReagentImportModal } from './ReagentImportModal'
import { InfoFormModal as ReagentInfoFormModal } from './ReagentInfoFormModal'
import { InventoryFormModal as ReagentInventoryFormModal } from './ReagentInventoryFormModal'
import type { ReagentListTab, ReagentModalState } from './reagentModalShared'

export type { ReagentListTab, ReagentModalState } from './reagentModalShared'
export { physicalStateLabel } from './reagentModalShared'

export function ReagentModal({
  state,
  catalog,
  onClose,
  onSaved,
}: {
  state: ReagentModalState | null
  catalog: readonly ReagentInfo[]
  onClose: () => void
  onSaved: (tab: ReagentListTab) => void
}) {
  if (!state) return null
  switch (state.type) {
    case 'catalog-detail':
      return <ReagentCatalogDetail info={state.info} onClose={onClose} />
    case 'history':
      return <ReagentHistoryModal reagent={state.reagent} onClose={onClose} />
    case 'create-info':
    case 'edit-info':
      return (
        <ReagentInfoFormModal state={state} onClose={onClose} onSaved={() => onSaved('catalog')} />
      )
    case 'dispense':
      return (
        <ReagentDispenseModal
          reagent={state.reagent}
          onClose={onClose}
          onSaved={() => onSaved('inventory')}
        />
      )
    case 'import':
      return (
        <ReagentImportModal
          target={state.target}
          onClose={onClose}
          onSaved={() => onSaved(state.target)}
        />
      )
    default:
      return (
        <ReagentInventoryFormModal
          state={state}
          catalog={catalog}
          onClose={onClose}
          onSaved={() => onSaved('inventory')}
        />
      )
  }
}
