import { useState } from 'react'

import type { PersistentWorkflowAuthoringModel } from './persistentWorkflowAuthoringModel'
import { MaterialSourceInspector } from './MaterialSourceInspector'
import { WorkflowActionParameterEditor } from './WorkflowActionParameterDrawer'

/** 固定在桌面画布右侧的节点检查器；窄屏继续由共享参数抽屉承载。 */
export function WorkflowNodeInspector({
  model
}: {
  model: PersistentWorkflowAuthoringModel
}): React.JSX.Element {
  const [inspectorPane, setInspectorPane] = useState<
    'parameters' | 'mapping' | 'runtime'
  >('parameters')
  const {
    bindTypedFieldToWorkflowInput,
    busy,
    canvasMutationEnabled,
    canvasSaveHint,
    diagnostics,
    graph,
    materialSourceAuthorityBlocked,
    materialSourceCatalogLoading,
    materialTraces,
    renameCanvasNode,
    resourceSlotOptions,
    revealPackageSource,
    selectedActionEditor,
    selectedActionTemplate,
    selectedIsMaterialSource,
    selectedMaterialSourceEditor,
    selectedNodeIsInternal,
    selectedNodeName,
    selectedNodeUuid,
    setActionParametersOpen,
    setMessage,
    setSelectedNodeName,
    setSelectedNodeNameDirty,
    setSelectedNodeUuid,
    taskNodeStates,
    updateMaterialSource,
    updateTypedField,
    updateTypedFieldFromRaw
  } = model
  const selectedNodeDescription = selectedNodeUuid
    ? model.structure.nodes.find((node) => node.id === selectedNodeUuid)
      ?.description?.trim()
    : ''

  return (
    <aside
      className={[
        'persistent-authoring__node-editor',
        selectedNodeUuid ? '' : 'is-empty'
      ].filter(Boolean).join(' ')}
      aria-label="画布节点编辑器"
    >
      <header className="persistent-authoring__inspector-heading">
        <span>
          <span>属性</span>
          <strong>
            {!selectedNodeUuid
              ? '节点检查器'
              : selectedIsMaterialSource ? '物料来源' : '节点属性'}
          </strong>
        </span>
        {selectedNodeUuid && (
          <button
            type="button"
            aria-label="取消节点选择"
            title="取消节点选择"
            onClick={() => {
              const nodeUuid = selectedNodeUuid
              setSelectedNodeUuid(null)
              setSelectedNodeName('')
              setSelectedNodeNameDirty(false)
              setActionParametersOpen(false)
              setInspectorPane('parameters')
              requestAnimationFrame(() => {
                document.querySelector<HTMLElement>(
                  `.x6-node[data-cell-id="${nodeUuid}"]`
                )?.focus({ preventScroll: true })
              })
            }}
          >
            ×
          </button>
        )}
      </header>

      {!selectedNodeUuid ? (
        <div className="persistent-authoring__inspector-empty">
          <span aria-hidden="true">◇</span>
          <strong>选择画布中的节点</strong>
          <p>在这里编辑名称和类型化参数，并查看输入、输出、运行状态与诊断。</p>
        </div>
      ) : (
        <>
          <label>
            节点名称
            <input
              value={selectedNodeName}
              disabled={busy || !canvasMutationEnabled || selectedNodeIsInternal}
              aria-describedby="persistent-node-description"
              onChange={(event) => {
                setSelectedNodeName(event.target.value)
                setSelectedNodeNameDirty(true)
                setMessage(canvasSaveHint)
              }}
              onBlur={() => renameCanvasNode(selectedNodeUuid, selectedNodeName)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
            />
          </label>
          <section
            id="persistent-node-description"
            className="persistent-authoring__node-description"
            aria-label="节点说明"
          >
            <strong>节点说明</strong>
            <p>{selectedNodeDescription || '当前节点暂无描述'}</p>
          </section>

          {selectedMaterialSourceEditor && (
            <MaterialSourceInspector
              editor={selectedMaterialSourceEditor}
              accent={materialTraces.materialSourceAccents.get(
                selectedMaterialSourceEditor.nodeUuid
              )}
              editable={
                !busy && canvasMutationEnabled &&
                !materialSourceCatalogLoading &&
                !materialSourceAuthorityBlocked
              }
              status={taskNodeStates[selectedNodeUuid] || 'pending'}
              diagnostics={diagnostics.filter(
                (diagnostic) => diagnostic.node_id === selectedNodeUuid
              )}
              onChange={(patch) => updateMaterialSource(
                selectedMaterialSourceEditor,
                patch
              )}
              onRevealSource={revealPackageSource}
            />
          )}

          {selectedActionEditor && (
            <>
              <nav
                className="persistent-authoring__node-tabs"
                aria-label="节点检查器视图"
              >
                {([
                  ['parameters', '参数配置'],
                  ['mapping', '输入 / 输出'],
                  ['runtime', '运行观察']
                ] as const).map(([pane, label]) => (
                  <button
                    key={pane}
                    type="button"
                    className={inspectorPane === pane ? 'is-active' : undefined}
                    aria-pressed={inspectorPane === pane}
                    onClick={() => setInspectorPane(pane)}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              {inspectorPane !== 'runtime' ? (
                <WorkflowActionParameterEditor
                  editor={selectedActionEditor}
                  outputHandles={selectedActionTemplate?.handles.filter(
                    (handle) => handle.ioType === 'source'
                  ) ?? []}
                  graph={graph}
                  editable={!busy && canvasMutationEnabled}
                  view={inspectorPane}
                  resourceSlotOptions={resourceSlotOptions}
                  onProviderChange={(field, provider) => {
                    if (provider.startsWith('workflow:')) {
                      bindTypedFieldToWorkflowInput(
                        field.handleUuid,
                        provider.slice('workflow:'.length)
                      )
                    } else if (
                      provider === 'literal' || provider === 'missing'
                    ) {
                      updateTypedField(field.handleUuid, undefined)
                    }
                  }}
                  onLiteralBlur={updateTypedFieldFromRaw}
                  onResourceChange={(field, materialUuid) => updateTypedField(
                    field.handleUuid,
                    materialUuid ? { uuid: materialUuid } : undefined
                  )}
                  onClear={(handleUuid) => updateTypedField(
                    handleUuid,
                    undefined
                  )}
                  onNull={(handleUuid) => updateTypedField(handleUuid, null)}
                />
              ) : (
                <section className="persistent-authoring__runtime-observer">
                  <div className="strategy-list">
                    <div className="strategy-item">
                      <span>节点状态</span>
                      <strong>{taskNodeStates[selectedNodeUuid] || '等待调试'}</strong>
                    </div>
                    <div className="strategy-item">
                      <span>参数合同</span>
                      <strong>{selectedActionEditor.diagnostics.length > 0
                        ? '需要处理'
                        : '校验通过'}</strong>
                    </div>
                    <div className="strategy-item">
                      <span>保存状态</span>
                      <strong>{canvasSaveHint}</strong>
                    </div>
                  </div>
                  {diagnostics.filter(
                    (diagnostic) => diagnostic.node_id === selectedNodeUuid
                  ).map((diagnostic, index) => (
                    <p key={`${diagnostic.code}:${index}`} role="alert">
                      {diagnostic.message}
                    </p>
                  ))}
                </section>
              )}
            </>
          )}
        </>
      )}
    </aside>
  )
}
