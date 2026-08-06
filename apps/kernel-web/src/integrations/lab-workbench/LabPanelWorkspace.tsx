import {
  PanelLayoutRenderer,
  reducePanelLayout,
  type PanelLayoutCommand,
  type PanelLayoutDocument
} from '@unilab/workbench-layout'
import {
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'

import { useLabPanelAdapter } from './panelAdapter'
import {
  panelPresetDocument,
  parsePanelPresetDocument,
  type LabPanelPreset
} from './panelLayouts'
import { WorkflowDirtySessions } from './workflowSessions'

export function LabPanelWorkspace({
  preset,
  onWorkflowUnsavedChangesChange,
  workflowCatalogRequestRevision = 0
}: {
  preset: LabPanelPreset
  onWorkflowUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void
  workflowCatalogRequestRevision?: number
}): React.JSX.Element {
  return (
    <LabPanelWorkspaceSession
      key={preset}
      preset={preset}
      onWorkflowUnsavedChangesChange={onWorkflowUnsavedChangesChange}
      workflowCatalogRequestRevision={workflowCatalogRequestRevision}
    />
  )
}

function LabPanelWorkspaceSession({
  preset,
  onWorkflowUnsavedChangesChange,
  workflowCatalogRequestRevision
}: {
  preset: LabPanelPreset
  onWorkflowUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void
  workflowCatalogRequestRevision: number
}): React.JSX.Element {
  const parentDirtyCallback = useRef(onWorkflowUnsavedChangesChange)
  parentDirtyCallback.current = onWorkflowUnsavedChangesChange
  const dirtySessions = useRef<WorkflowDirtySessions | null>(null)
  if (dirtySessions.current === null) {
    dirtySessions.current = new WorkflowDirtySessions((hasUnsavedChanges) => {
      parentDirtyCallback.current?.(hasUnsavedChanges)
    })
  }
  const handleWorkflowUnsavedChangesChange = useCallback((
    sessionId: string,
    hasUnsavedChanges: boolean
  ) => {
    dirtySessions.current?.update(sessionId, hasUnsavedChanges)
  }, [])
  const adapter = useLabPanelAdapter(
    handleWorkflowUnsavedChangesChange,
    workflowCatalogRequestRevision
  )
  const storageKey = `unilab.panel-layout.${preset}.v1`
  const [document, setDocument] = useState<PanelLayoutDocument>(
    () => panelPresetDocument(preset)
  )

  useEffect(() => {
    let active = true
    void Promise.resolve()
      .then(() => adapter.storage.load(storageKey))
      .then((stored) => {
        if (active && stored) {
          setDocument(parsePanelPresetDocument(preset, stored))
        }
      })
      .catch(() => {
        if (!active) {
          return
        }

        const fallback = panelPresetDocument(preset)
        setDocument(fallback)
        try {
          void Promise.resolve(
            adapter.storage.save(storageKey, fallback)
          ).catch(() => {
            // The in-memory fallback still keeps the preset usable.
          })
        } catch {
          // The in-memory fallback still keeps the preset usable.
        }
      })
    return () => {
      active = false
    }
  }, [adapter, preset, storageKey])

  const handleCommand = useCallback(
    (command: PanelLayoutCommand) => {
      setDocument((current) => {
        const next = reducePanelLayout(
          current,
          command,
          adapter.registry.list()
        )
        void Promise.resolve(
          adapter.storage.save(storageKey, next)
        )
        return next
      })
    },
    [adapter, storageKey]
  )

  return (
    <div className={`lab-panel-workspace lab-panel-workspace--${preset}`}>
      <PanelLayoutRenderer
        adapter={adapter}
        document={document}
        onCommand={handleCommand}
      />
    </div>
  )
}
