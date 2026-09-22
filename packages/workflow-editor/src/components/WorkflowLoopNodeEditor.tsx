import type {
  WorkflowActionCatalogSnapshot,
  WorkflowAuthoringGraph
} from '@unilab/services'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  projectWorkflowLoopEditor,
  updateWorkflowLoopParam
} from '../utils/workflowLoopControl'
import {
  projectExperimentOperationDeviceActions,
  useExperimentOperationDeviceCatalog
} from './ExperimentOperationDeviceCatalog'


function loopUntilForm(condition: Record<string, unknown>): {
  variable: string
  operator: string
  value: string
} {
  if (condition.lit === true) return { variable: '', operator: 'literal_true', value: '' }
  if (condition.lit === false) return { variable: '', operator: 'literal_false', value: '' }
  if (typeof condition.var === 'string') {
    return { variable: condition.var, operator: 'truthy', value: '' }
  }
  if (typeof condition.binop === 'string') {
    const left = condition.left && typeof condition.left === 'object'
      ? condition.left as Record<string, unknown> : {}
    const right = condition.right && typeof condition.right === 'object'
      ? condition.right as Record<string, unknown> : {}
    return {
      variable: typeof left.var === 'string' ? left.var : '',
      operator: condition.binop,
      value: Object.prototype.hasOwnProperty.call(right, 'lit')
        ? JSON.stringify(right.lit) : ''
    }
  }
  return { variable: '', operator: 'literal_true', value: '' }
}

function loopUntilLiteral(raw: string): unknown {
  const value = raw.trim()
  if (!value) return ''
  try { return JSON.parse(value) } catch { return raw }
}

function buildLoopUntil(variable: string, operator: string, value: string): Record<string, unknown> {
  if (operator === 'literal_true') return { lit: true }
  if (operator === 'literal_false') return { lit: false }
  if (operator === 'truthy') return { var: variable || 'done' }
  return {
    binop: operator,
    left: { var: variable || 'done' },
    right: { lit: loopUntilLiteral(value) }
  }
}
/** Dify Loop 风格的循环编排编辑器：配置循环变量、最大轮次、循环体与退出后继。 */
export function WorkflowLoopNodeEditor({
  graph,
  nodeUuid,
  editable,
  onChange,
  actionCatalog,
  actionCatalogError,
  onAddActionToLoop,
  openAddNodeRequest,
  onAddNodeRequestHandled
}: {
  graph: WorkflowAuthoringGraph
  nodeUuid: string
  editable: boolean
  onChange(param: Record<string, unknown>): void
  actionCatalog?: WorkflowActionCatalogSnapshot | null
  actionCatalogError?: string | null
  onAddActionToLoop?: (templateUuid: string, loopUuid: string) => void
  openAddNodeRequest?: boolean
  onAddNodeRequestHandled?: () => void
}): React.JSX.Element {
  const [addNodeOpen, setAddNodeOpen] = useState(false)
  const [nodeToAdd, setNodeToAdd] = useState('')
  const [actionQuery, setActionQuery] = useState('')
  const [actionPickerOpen, setActionPickerOpen] = useState(false)
  const deviceCatalog = useExperimentOperationDeviceCatalog()
  const editor = projectWorkflowLoopEditor(graph, nodeUuid)
  const actionLibraryOptions = useMemo(() => {
    const templates = actionCatalog?.actionTemplates ?? []
    const projected = deviceCatalog
      ? projectExperimentOperationDeviceActions(
        deviceCatalog.devices,
        templates,
        ''
      )
      : null
    const matchedTemplateUuids = new Set<string>()
    const deviceOptions = projected?.devices.flatMap(device => device.actions.map(action => {
      const templateUuid = action.template?.uuid ?? null
      if (templateUuid) matchedTemplateUuids.add(templateUuid)
      return {
        key: `device:${device.deviceKey}:${action.actionName}:${action.typeName}`,
        selectionValue: templateUuid ? `template:${templateUuid}` : '',
        uuid: templateUuid ?? `${device.deviceKey}:${action.actionName}:${action.typeName}`,
        label: action.label || action.actionName,
        detail: `${device.machineName} · ${action.actionName}`,
        disabled: !templateUuid,
        searchText: [
          device.machineName,
          device.deviceKey,
          action.label,
          action.actionName,
          action.typeName
        ].filter(Boolean).join(' ').toLocaleLowerCase()
      }
    })) ?? []
    const templateOptions = templates
      .filter(template => !matchedTemplateUuids.has(template.uuid))
      .filter(template =>
        template.nodeType !== 'condition' &&
        template.nodeType !== 'repeat_until' &&
        template.actionType !== 'condition' &&
        template.actionType !== 'repeat_until'
      )
      .map(template => ({
          key: `template:${template.uuid}`,
          selectionValue: `template:${template.uuid}`,
          uuid: template.uuid,
          label: template.displayName || template.name,
          detail: template.resourceTemplateName || template.actionType,
          disabled: false,
          searchText: [
            template.displayName,
            template.name,
            template.actionType,
            template.actionClass,
            template.resourceTemplateName
          ].filter(Boolean).join(' ').toLocaleLowerCase()
        }))
    // 实验操作场景优先呈现设备动作声明本身，数量与左侧设备动作库保持一致。
    // 没有设备目录的普通工作流再回退到动作模板目录。
    return projected ? deviceOptions : templateOptions
  }, [actionCatalog, deviceCatalog])
  const filteredActionLibraryOptions = useMemo(() => {
    const query = actionQuery.trim().toLocaleLowerCase()
    return actionLibraryOptions.filter(option => !query || option.searchText.includes(query))
  }, [actionLibraryOptions, actionQuery])
  const existingNodeOptions = editor.candidateNodes
    .filter(candidate => !editor.bodyNodeUuids.includes(candidate.uuid))
    .map(candidate => ({
      uuid: candidate.uuid,
      label: candidate.name,
      detail: '当前画布节点',
      searchText: `${candidate.name} 当前画布节点`.toLocaleLowerCase()
    }))
  const filteredExistingNodeOptions = existingNodeOptions.filter(option => {
    const query = actionQuery.trim().toLocaleLowerCase()
    return !query || option.searchText.includes(query)
  })
  const selectedActionOption = [
    ...actionLibraryOptions,
    ...existingNodeOptions.map(option => ({
      ...option,
      selectionValue: `node:${option.uuid}`
    }))
  ].find(option => option.selectionValue && option.selectionValue === nodeToAdd)
  useEffect(() => {
    if (!openAddNodeRequest) return
    setAddNodeOpen(true)
    onAddNodeRequestHandled?.()
  }, [onAddNodeRequestHandled, openAddNodeRequest])
  useEffect(() => {
    if (!addNodeOpen) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setAddNodeOpen(false)
      setActionPickerOpen(false)
      setNodeToAdd('')
      setActionQuery('')
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [addNodeOpen])
  const until = loopUntilForm(editor.until)
  const commit = (patch: Parameters<typeof updateWorkflowLoopParam>[1]): void => {
    onChange(updateWorkflowLoopParam(graph.nodes.find(n => n.uuid === nodeUuid)?.param, patch))
  }
  const selected = (event: React.ChangeEvent<HTMLSelectElement>): string[] =>
    [...event.target.selectedOptions].map(option => option.value)
  const candidateName = (uuid: string): string =>
    editor.candidateNodes.find(candidate => candidate.uuid === uuid)?.name ?? uuid
  const removeBodyNode = (uuid: string): void => {
    commit({ bodyNodeUuids: editor.bodyNodeUuids.filter(item => item !== uuid) })
  }
  const closeAddNodeDialog = (): void => {
    setNodeToAdd('')
    setActionQuery('')
    setActionPickerOpen(false)
    setAddNodeOpen(false)
  }

  return (
    <section className="workflow-loop-editor" aria-label="循环编排配置">
      <header>
        <span><strong>循环编排</strong><small>最多轮次内重复执行循环体，满足条件后退出</small></span>
      </header>
      <div className="workflow-loop-editor__grid">
        <label className="workflow-loop-editor__field">
          <span>循环变量名</span>
          <input value={editor.loopVariable} disabled={!editable}
            onChange={event => commit({ loopVariable: event.target.value })} />
        </label>
        <label className="workflow-loop-editor__field">
          <span>最多循环次数</span>
          <input type="number" min={1} value={editor.maxIterations} disabled={!editable}
            onChange={event => commit({ maxIterations: Number(event.target.value) || 1 })} />
        </label>
      </div>
      <fieldset className="workflow-loop-editor__until">
        <legend>循环终止条件</legend>
        <small>每轮循环体执行完毕后判断；条件满足时终止循环。</small>
        <div className="workflow-loop-editor__grid">
          <label className="workflow-loop-editor__field">
            <span>判断方式</span>
            <select value={until.operator} disabled={!editable}
              onChange={event => commit({
                until: buildLoopUntil(until.variable, event.target.value, until.value)
              })}>
              <option value="literal_true">固定为真（测试）</option>
              <option value="literal_false">固定为假（测试）</option>
              <option value="truthy">参数为真</option>
              <option value="==">等于</option><option value="!=">不等于</option>
              <option value=">">大于</option><option value=">=">大于等于</option>
              <option value="<">小于</option><option value="<=">小于等于</option>
            </select>
          </label>
          {!until.operator.startsWith('literal_') && (
            <label className="workflow-loop-editor__field">
              <span>参数名</span>
              <input value={until.variable} disabled={!editable} placeholder="例如 done"
                onChange={event => commit({
                  until: buildLoopUntil(event.target.value, until.operator, until.value)
                })} />
            </label>
          )}
        </div>
        {!until.operator.startsWith('literal_') && until.operator !== 'truthy' && (
          <label className="workflow-loop-editor__field">
            <span>比较值</span>
            <input value={until.value} disabled={!editable} placeholder="true、数字或文本"
              onChange={event => commit({
                until: buildLoopUntil(until.variable, until.operator, event.target.value)
              })} />
          </label>
        )}
      </fieldset>
      <section className="workflow-loop-editor__members" aria-label="循环体执行节点">
        <div className="workflow-loop-editor__members-actions">
          <span>循环体执行节点</span>
          <button type="button" disabled={!editable} onClick={() => setAddNodeOpen(true)}>
            ＋ 添加节点
          </button>
        </div>
        <div className="workflow-loop-editor__member-list" role="list">
          {editor.bodyNodeUuids.length ? editor.bodyNodeUuids.map(uuid => (
            <div className="workflow-loop-editor__member" key={uuid} role="listitem">
              <span>{candidateName(uuid)}</span>
              <button type="button" disabled={!editable} aria-label={`移除${candidateName(uuid)}`}
                onClick={() => removeBodyNode(uuid)}>×</button>
            </div>
          )) : <span className="workflow-loop-editor__member-empty">暂未添加循环动作</span>}
        </div>
        <small>循环动作将在画布循环体内按顺序执行。</small>
      </section>
      {addNodeOpen && (
        typeof document !== 'undefined' && createPortal(
          <div className="workflow-loop-editor__modal-backdrop" role="presentation"
            onMouseDown={closeAddNodeDialog}>
            <div className="workflow-loop-editor__add-dialog" role="dialog" aria-modal="true"
              aria-label="添加节点到循环体" onMouseDown={event => event.stopPropagation()}>
              <header>
                <strong>添加节点到循环体</strong>
                <button className="workflow-loop-editor__modal-close" type="button" aria-label="关闭"
                  onClick={closeAddNodeDialog}><span aria-hidden="true" /></button>
              </header>
              <p>从设备动作库选择节点，添加后会按顺序在循环中执行。</p>
              <div className="workflow-loop-editor__action-picker">
                <span className="workflow-loop-editor__action-picker-label">动作节点</span>
                <button
                  className="workflow-loop-editor__action-picker-control"
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={actionPickerOpen}
                  aria-label="选择设备动作"
                  onClick={() => setActionPickerOpen(open => !open)}
                >
                  <span className={selectedActionOption ? '' : 'workflow-loop-editor__action-picker-placeholder'}>
                    {selectedActionOption
                      ? `${selectedActionOption.label} · ${selectedActionOption.detail}`
                      : '请选择动作节点'}
                  </span>
                  <span className="workflow-loop-editor__action-picker-chevron" aria-hidden="true">⌄</span>
                </button>
                {actionPickerOpen && (
                  <div
                    className="workflow-loop-editor__action-picker-menu"
                    role="listbox"
                    aria-label="设备动作选项"
                    onMouseDown={event => event.stopPropagation()}
                  >
                    <input
                      className="workflow-loop-editor__action-picker-search"
                      type="search"
                      autoFocus
                      value={actionQuery}
                      placeholder="搜索设备、动作或类型"
                      aria-label="筛选设备动作"
                      onChange={event => setActionQuery(event.target.value)}
                    />
                    <div className="workflow-loop-editor__action-picker-options">
                      {filteredActionLibraryOptions.length > 0 && (
                        <div className="workflow-loop-editor__action-picker-group" role="group" aria-label={`设备动作库（${filteredActionLibraryOptions.length}）`}>
                          <span className="workflow-loop-editor__action-picker-group-label">设备动作库（{filteredActionLibraryOptions.length}）</span>
                          {filteredActionLibraryOptions.map(option => (
                            <button
                              className="workflow-loop-editor__action-picker-option"
                              key={option.key}
                              type="button"
                              role="option"
                              aria-selected={nodeToAdd === option.selectionValue}
                              disabled={option.disabled}
                              onClick={() => {
                                setNodeToAdd(option.selectionValue)
                                setActionQuery('')
                                setActionPickerOpen(false)
                              }}
                            >
                              <strong>{option.label}</strong>
                              <small>{option.detail}{option.disabled ? '（模板未就绪）' : ''}</small>
                            </button>
                          ))}
                        </div>
                      )}
                      {filteredExistingNodeOptions.length > 0 && (
                        <div className="workflow-loop-editor__action-picker-group" role="group" aria-label="当前画布节点">
                          <span className="workflow-loop-editor__action-picker-group-label">当前画布节点</span>
                          {filteredExistingNodeOptions.map(option => (
                            <button
                              className="workflow-loop-editor__action-picker-option"
                              key={`node:${option.uuid}`}
                              type="button"
                              role="option"
                              aria-selected={nodeToAdd === `node:${option.uuid}`}
                              onClick={() => {
                                setNodeToAdd(`node:${option.uuid}`)
                                setActionQuery('')
                                setActionPickerOpen(false)
                              }}
                            >
                              <strong>{option.label}</strong>
                              <small>{option.detail}</small>
                            </button>
                          ))}
                        </div>
                      )}
                      {filteredActionLibraryOptions.length === 0 && filteredExistingNodeOptions.length === 0 && (
                        <small className="workflow-loop-editor__modal-empty" role="status">
                          {deviceCatalog?.loading
                            ? '正在读取设备动作库…'
                            : actionQuery.trim()
                              ? '没有匹配的设备动作'
                              : '设备动作库暂无可用动作'}
                        </small>
                      )}
                    </div>
                    {deviceCatalog?.error && (
                      <small className="workflow-loop-editor__modal-empty" role="alert">
                        {deviceCatalog.error}
                      </small>
                    )}
                    {actionCatalogError && (
                      <small className="workflow-loop-editor__modal-empty" role="alert">
                        {actionCatalogError}；匹配模板加载完成后才能添加新动作。
                      </small>
                    )}
                  </div>
                )}
              </div>
              <footer>
                <button className="workflow-loop-editor__modal-secondary" type="button"
                  onClick={closeAddNodeDialog}>取消</button>
                <button className="workflow-loop-editor__modal-primary" type="button" disabled={!nodeToAdd} onClick={() => {
                  if (!nodeToAdd) return
                  if (nodeToAdd.startsWith('template:')) {
                    onAddActionToLoop?.(nodeToAdd.slice('template:'.length), nodeUuid)
                    closeAddNodeDialog()
                    return
                  }
                  const selectedNodeUuid = nodeToAdd.slice('node:'.length)
                  onChange(updateWorkflowLoopParam(graph.nodes.find(n => n.uuid === nodeUuid)?.param, {
                    bodyNodeUuids: [...editor.bodyNodeUuids, selectedNodeUuid]
                  }))
                  closeAddNodeDialog()
                }}>添加到循环体</button>
              </footer>
            </div>
          </div>,
          document.body
        )
      )}
      <label className="workflow-loop-editor__members">
        <span>循环完成后的后继节点（可选）</span>
        <select multiple value={editor.successorNodeUuids} disabled={!editable}
          onChange={event => commit({ successorNodeUuids: selected(event) })}>
          {editor.candidateNodes.map(candidate => (
            <option key={candidate.uuid} value={candidate.uuid}>{candidate.name}</option>
          ))}
        </select>
        <small>满足退出条件后按选择顺序继续执行。</small>
      </label>
    </section>
  )
}
