import { clsx } from 'clsx'
import materialsPageStyles from './MaterialsPage.module.scss'
import appShellStyles from '../../styles/app-shell.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { Button, Input, Space, Tooltip } from 'antd'
import { useCallback, useMemo, useState } from 'react'
import { useBackendQuery } from '../../hooks/useBackendQuery'
import type { QueryFreshness } from '../../hooks/queryCache'
import { useRuntimeInvalidation } from '../../hooks/useRuntimeInvalidation'
import { AppIcon } from '../../components/ui/Icon'
import { AsyncState } from '../../components/ui/AsyncState'
import { PageHeader } from '../../components/ui/PageHeader'
import { projectMaterialInspection } from '@unilab-fe/core'
import {
  isMaterialGraphNodeHidden,
  MaterialFlowCanvas,
  type MaterialSelection,
} from './MaterialFlowCanvas'
import { MaterialInspector } from './MaterialInspector'
import { MaterialManagement } from './MaterialManagement'

/**
 * 物料位置、用量和使用状态随任务执行由 OS 记账，OS 不单独发物料通知：任务/设备动作运行失效通知
 * 到达时缓存过期并重读物料图。运行中通知几乎连续到达，通知驱动的重读至少间隔 3 秒且不并发；
 * 刷新按钮不受限制。
 */
const MATERIAL_GRAPH_FRESHNESS: QueryFreshness = {
  invalidateOnRuntimeEvents: true,
  minRefreshGapMs: 3_000,
}

export function MaterialsPage() {
  const query = useBackendQuery(
    'material-graph',
    (backend) => backend.core.materialSite.getGraph(),
    MATERIAL_GRAPH_FRESHNESS,
  )
  useRuntimeInvalidation(query.refresh, { minIntervalMs: MATERIAL_GRAPH_FRESHNESS.minRefreshGapMs })
  const [selection, setSelection] = useState<MaterialSelection | null>(null)
  const [keyword, setKeyword] = useState('')
  const [management, setManagement] = useState(false)
  const allNodes = query.data?.nodes ?? []
  const nodeById = useMemo(
    () => new Map(allNodes.map((node) => [node.material.materialUuid, node])),
    [allNodes],
  )
  const handleSelection = useCallback(
    (next: MaterialSelection) => {
      if (next.kind !== 'node') {
        setSelection(next)
        return
      }
      let selected = nodeById.get(next.nodeId)
      const visited = new Set<string>()
      while (
        selected &&
        isMaterialGraphNodeHidden(selected) &&
        selected.material.parentMaterialUuid
      ) {
        if (visited.has(selected.material.materialUuid)) break
        visited.add(selected.material.materialUuid)
        const parent = nodeById.get(selected.material.parentMaterialUuid)
        if (!parent) break
        selected = parent
        if (!isMaterialGraphNodeHidden(selected)) break
      }
      setSelection({ kind: 'node', nodeId: selected?.material.materialUuid ?? next.nodeId })
    },
    [nodeById],
  )
  const normalizedKeyword = keyword.trim().toLowerCase()
  const matchingIds = useMemo(
    () =>
      new Set(
        normalizedKeyword
          ? allNodes
              .filter((node) =>
                `${node.material.name} ${node.material.barcode ?? ''}`
                  .toLowerCase()
                  .includes(normalizedKeyword),
              )
              .map((node) => node.material.materialUuid)
          : [],
      ),
    [allNodes, normalizedKeyword],
  )
  const inspection = useMemo(() => {
    if (!query.data || !selection) return undefined
    return projectMaterialInspection(query.data, toInspectionSelection(selection)) ?? undefined
  }, [query.data, selection])
  if (management)
    return <MaterialManagement graph={query.data} onBack={() => setManagement(false)} />
  return (
    <div className={clsx(appShellStyles['page-stack'], sharedStyles['page-stack'])}>
      <PageHeader
        title="物料"
        actions={
          <Space>
            <Tooltip title="刷新">
              <Button
                type="text"
                loading={query.loading}
                aria-label="刷新物料图"
                icon={<AppIcon name="arrows/refresh-ccw-01" size={18} />}
                onClick={query.reload}
              />
            </Tooltip>
            <Button
              icon={<AppIcon name="layout/layers-three-01" size={16} />}
              onClick={() => setManagement(true)}
            >
              物料管理
            </Button>
          </Space>
        }
      />
      <AsyncState
        loading={query.loading}
        error={query.error}
        onRetry={query.reload}
        empty={!query.loading && allNodes.length === 0}
        emptyDescription="后端没有返回物料图"
      >
        <div
          className={clsx(
            materialsPageStyles['resource-toolbar'],
            sharedStyles['resource-toolbar'],
          )}
        >
          <Input
            className={clsx(materialsPageStyles['search-input'], sharedStyles['search-input'])}
            allowClear
            prefix={<AppIcon name="general/search-md" size={16} />}
            placeholder="搜索物料名称或条码"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <span
            className={clsx(
              materialsPageStyles['toolbar-hint'],
              normalizedKeyword ? materialsPageStyles['is-searching'] : '',
            )}
            aria-live="polite"
          >
            {normalizedKeyword
              ? `${matchingIds.size} / ${allNodes.length} 个节点匹配`
              : `${allNodes.length} 个节点`}
          </span>
        </div>
        <div
          className={clsx(
            materialsPageStyles['material-workspace'],
            appShellStyles['material-workspace'],
            sharedStyles['material-workspace'],
          )}
        >
          <MaterialFlowCanvas
            nodes={allNodes}
            hasSearch={Boolean(normalizedKeyword)}
            highlightedIds={matchingIds}
            selectedId={
              selection?.kind === 'material'
                ? selection.materialId
                : selection?.kind === 'node'
                  ? selection.nodeId
                  : undefined
            }
            selectedSiteId={
              selection?.kind === 'material'
                ? selection.siteId
                : selection?.kind === 'site'
                  ? selection.siteId
                  : undefined
            }
            onSelect={handleSelection}
          />
          <MaterialInspector
            projection={inspection}
            selection={selection}
            onSelect={handleSelection}
          />
        </div>
      </AsyncState>
    </div>
  )
}

function toInspectionSelection(selection: MaterialSelection) {
  if (selection.kind === 'node') {
    return { kind: 'node' as const, materialUuid: selection.nodeId }
  }
  if (selection.kind === 'site') {
    return { kind: 'site' as const, siteUuid: selection.siteId }
  }
  return {
    kind: 'material' as const,
    materialUuid: selection.materialId,
    siteUuid: selection.siteId,
  }
}
