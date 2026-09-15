import {
  workflowDefinitionKind,
  type WorkflowDefinitionKind,
  type WorkflowRuntimePort,
  type WorkflowSummary
} from '@unilab/services'
import type { ComponentProps } from 'react'
import { useEffect, useMemo, useState } from 'react'

import { WorkflowButton } from './WorkflowButton'
import { ExperimentOperationDeviceLibrary } from './ExperimentOperationDeviceLibrary'
import { WorkflowNodePalette } from './WorkflowNodePalette'
import { writeWorkflowNodePaletteDragPayload, type WorkflowNodePaletteDragPayload } from '../utils/workflowCanvasCommands'

type WorkflowNodePaletteProps = ComponentProps<typeof WorkflowNodePalette>

interface WorkflowAuthoringLibraryProps extends WorkflowNodePaletteProps {
  runtime: WorkflowRuntimePort
  workflowUuid: string
  workflowName?: string
  definitionKind?: WorkflowDefinitionKind
  authoringDirty: boolean
  onSelectWorkflow?: (workflowUuid: string, workflowName: string) => void
  onPaletteDragStart?: (payload: WorkflowNodePaletteDragPayload) => void
}

/**
 * 把工作流目录导航与真实节点模板收敛为工作流调试左侧库。
 *
 * 目录只是 Backend/OS 权威摘要的只读投影；节点创建仍委托给画布草稿命令。
 */
export function WorkflowAuthoringLibrary({
  runtime,
  workflowUuid,
  workflowName,
  definitionKind = 'workflow',
  authoringDirty,
  onSelectWorkflow,
  onPaletteDragStart,
  ...paletteProps
}: WorkflowAuthoringLibraryProps): React.JSX.Element {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  const [operations, setOperations] = useState<WorkflowSummary[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requestRevision, setRequestRevision] = useState(0)
  const [operationLibraryTab, setOperationLibraryTab] =
    useState<'operation' | 'device-action'>('operation')
  const [workflowLibraryTab, setWorkflowLibraryTab] =
    useState<'workflow' | 'operation'>('workflow')

  useEffect(() => {
    let disposed = false
    setLoading(true)
    setError(null)
    void runtime.listWorkflows({ page: 1, page_size: 100 })
      .then((page) => {
        if (!disposed) {
          setWorkflows(page.items.filter(workflow => workflowDefinitionKind(workflow) === definitionKind))
          setOperations(page.items.filter(workflow => workflowDefinitionKind(workflow) === 'operation'))
        }
      })
      .catch((reason: unknown) => {
        if (!disposed) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [definitionKind, requestRevision, runtime])

  const visibleWorkflows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return [...workflows]
      .filter((workflow) => !normalizedQuery || [
        workflow.name,
        workflow.uuid,
        workflow.description ?? '',
        ...workflow.tags
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery)))
      .sort((left, right) => right.update_time.localeCompare(left.update_time) || left.uuid.localeCompare(right.uuid))
  }, [query, workflows])

  const workflowList = (
    <div className="persistent-authoring__library-workflow-list" role="list">
      {loading ? (
        <p role="status">正在读取{definitionKind === 'operation'
          ? '实验操作'
          : '工作流'}…</p>
      ) : error ? (
        <div className="persistent-authoring__library-problem" role="alert">
          <span>{definitionKind === 'operation'
            ? '实验操作目录读取失败'
            : '工作流目录读取失败'}</span>
          <button type="button" onClick={() => setRequestRevision((value) => value + 1)}>
            重试
          </button>
        </div>
      ) : visibleWorkflows.length === 0 ? (
        <p role="status">没有匹配的{definitionKind === 'operation'
          ? '实验操作'
          : '工作流'}</p>
      ) : visibleWorkflows.map((workflow) => {
        const active = workflow.uuid === workflowUuid
        const switchDisabled = !active && (authoringDirty || !onSelectWorkflow)
        return (
          <WorkflowButton
            key={workflow.uuid}
            type="button"
            role="listitem"
            className={active ? 'is-active' : undefined}
            aria-current={active ? 'page' : undefined}
            disabled={switchDisabled}
            disabledReason={authoringDirty
              ? '请先保存当前工作流修改'
              : '当前工作区固定为此工作流'}
            onClick={() => {
              if (!active) onSelectWorkflow?.(workflow.uuid, workflow.name)
            }}
          >
            <span aria-hidden="true">◇</span>
            <span>
              <strong>{workflow.name}</strong>
              <small>{definitionKind === 'workflow'
                ? `版本 ${workflow.revision ?? '—'}`
                : workflow.description?.trim() || '暂无描述'}</small>
            </span>
            {active && <i>当前</i>}
          </WorkflowButton>
        )
      })}
      {!loading && !error && visibleWorkflows.every(
        (workflow) => workflow.uuid !== workflowUuid
      ) && (
        <div className="persistent-authoring__workflow-current">
          <span aria-hidden="true">◇</span>
          <span>
            <strong>{workflowName || '当前工作流'}</strong>
            <small>{workflowUuid}</small>
          </span>
          <i>当前</i>
        </div>
      )}
    </div>
  )

  return (
    <section
      className="persistent-authoring__library"
      aria-label={definitionKind === 'operation'
        ? '实验操作与节点库'
        : '实验工作流与节点库'}
    >
      <header className="persistent-authoring__library-heading">
        <div>
          <h2>{definitionKind === 'operation' ? '操作与节点库' : '工作流与操作库'}</h2>
        </div>
        {definitionKind !== 'operation' ? <span>{workflows.length}</span> : null}
      </header>

      {definitionKind === 'operation' ? (
        <>
          <div className="persistent-authoring__library-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={operationLibraryTab === 'operation'}
              className={operationLibraryTab === 'operation' ? 'is-active' : undefined}
              onClick={() => setOperationLibraryTab('operation')}
            >
              实验操作库
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={operationLibraryTab === 'device-action'}
              className={operationLibraryTab === 'device-action' ? 'is-active' : undefined}
              onClick={() => setOperationLibraryTab('device-action')}
            >
              设备动作库
            </button>
          </div>
          {operationLibraryTab === 'operation' ? (
            <div className="persistent-authoring__library-pane">
              <label className="persistent-authoring__library-search">
                <span className="sr-only">搜索实验操作</span>
                <input
                  type="search"
                  value={query}
                  placeholder="搜索操作名称 / 编号"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              {workflowList}
            </div>
          ) : (
            <div className="persistent-authoring__library-pane">
              <ExperimentOperationDeviceLibrary
                catalog={paletteProps.catalog}
                error={paletteProps.catalogError}
                disabled={paletteProps.busy || !paletteProps.canvasMutationEnabled ||
                  !paletteProps.graphAvailable}
                disabledReason={paletteProps.busy
                  ? '正在处理实验操作，请稍后添加节点'
                  : !paletteProps.canvasMutationEnabled
                    ? '当前模式只允许查看实验操作'
                    : '实验操作画布尚未加载完成'}
                onAddAction={paletteProps.onAddAction}
                onPaletteDragStart={onPaletteDragStart}
              />
            </div>
          )}
        </>
      ) : (
        <>
          <div className="persistent-authoring__library-tabs" role="tablist" aria-label="工作流与操作库">
            <button type="button" role="tab" aria-selected={workflowLibraryTab === 'workflow'} className={workflowLibraryTab === 'workflow' ? 'is-active' : undefined} onClick={() => setWorkflowLibraryTab('workflow')}>实验工作流库</button>
            <button type="button" role="tab" aria-selected={workflowLibraryTab === 'operation'} className={workflowLibraryTab === 'operation' ? 'is-active' : undefined} onClick={() => setWorkflowLibraryTab('operation')}>实验操作库</button>
          </div>
          {workflowLibraryTab === 'workflow' ? <div className="persistent-authoring__library-pane">
          <label className="persistent-authoring__library-search">
            <span className="sr-only">搜索实验工作流</span>
            <input
              type="search"
              value={query}
              placeholder="搜索工作流名称 / 编号"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="persistent-authoring__library-section-label">最近编辑</div>
          {workflowList}
          </div> : <div className="persistent-authoring__library-pane">
            <div className="persistent-authoring__library-workflow-list" role="list">
              {loading ? <p role="status">正在读取实验操作…</p> : error ? (
                <div role="alert">实验操作目录读取失败<button type="button" onClick={() => setRequestRevision(value => value + 1)}>重试</button></div>
              ) : operations.map(operation => {
                const template = paletteProps.catalog?.workflowTemplates.find(item => item.workflowUuid === operation.uuid)
                const disabled = !template || paletteProps.busy || !paletteProps.canvasMutationEnabled || !paletteProps.graphAvailable
                return <WorkflowButton
                  key={operation.uuid}
                  role="listitem"
                  type="button"
                  disabled={disabled}
                  disabledReason={!template ? '请先在实验操作调试中发布该实验操作' : '当前画布暂不可编辑'}
                  draggable={!disabled}
                  onClick={() => { if (template) paletteProps.onAddWorkflow(template.uuid) }}
                  onDragStart={event => {
                    if (disabled || !template) { event.preventDefault(); return }
                    const payload: WorkflowNodePaletteDragPayload = { kind: 'workflow', templateUuid: template.uuid }
                    writeWorkflowNodePaletteDragPayload(event.dataTransfer, payload)
                    onPaletteDragStart?.(payload)
                  }}
                >
                  <span aria-hidden="true">◇</span>
                  <span><strong>{operation.name}</strong><small>{template ? `版本 ${template.workflowRevision}` : '尚未发布'}</small></span>
                </WorkflowButton>
              })}
              {!loading && !error && operations.length === 0 && <p role="status">暂无实验操作</p>}
            </div>
          </div>}
        </>
      )}
    </section>
  )
}
