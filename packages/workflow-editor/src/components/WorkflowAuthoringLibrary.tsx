import {
  workflowDefinitionKind,
  type WorkflowDefinitionKind,
  type WorkflowRuntimePort,
  type WorkflowSummary
} from '@unilab/services'
import type { ComponentProps } from 'react'
import { useEffect, useMemo, useState } from 'react'

import { WorkflowButton } from './WorkflowButton'
import { WorkflowNodePalette } from './WorkflowNodePalette'

type WorkflowNodePaletteProps = ComponentProps<typeof WorkflowNodePalette>

interface WorkflowAuthoringLibraryProps extends WorkflowNodePaletteProps {
  runtime: WorkflowRuntimePort
  workflowUuid: string
  workflowName?: string
  definitionKind?: WorkflowDefinitionKind
  authoringDirty: boolean
  onSelectWorkflow?: (workflowUuid: string, workflowName: string) => void
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
  ...paletteProps
}: WorkflowAuthoringLibraryProps): React.JSX.Element {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requestRevision, setRequestRevision] = useState(0)

  useEffect(() => {
    let disposed = false
    setLoading(true)
    setError(null)
    void runtime.listWorkflows({ page: 1, page_size: 100 })
      .then((page) => {
        if (!disposed) setWorkflows(page.items.filter(
          workflow => workflowDefinitionKind(workflow) === definitionKind
        ))
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
        workflow.description ?? '',
        ...workflow.tags
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery)))
      .sort((left, right) => right.update_time.localeCompare(left.update_time))
      .slice(0, 6)
  }, [query, workflows])

  return (
    <section
      className="persistent-authoring__library"
      aria-label={definitionKind === 'operation'
        ? '实验操作与节点库'
        : '实验工作流与节点库'}
    >
      <header className="persistent-authoring__library-heading">
        <div>
          <h2>{definitionKind === 'operation' ? '实验操作' : '实验工作流'}</h2>
          <small>最近编辑</small>
        </div>
        <span>{workflows.length}</span>
      </header>

      <label className="persistent-authoring__library-search">
        <span className="sr-only">搜索{definitionKind === 'operation'
          ? '实验操作'
          : '实验工作流'}</span>
        <input
          type="search"
          value={query}
          placeholder={definitionKind === 'operation'
            ? '搜索操作名称'
            : '搜索工作流名称'}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

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
                <small>v{workflow.revision} · {workflow.definition_status === 'empty'
                  ? '待编排'
                  : '已配置'}</small>
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

      <div className="persistent-authoring__library-nodes">
        <WorkflowNodePalette {...paletteProps} />
      </div>
    </section>
  )
}
