import { clsx } from 'clsx'
import materialManagementStyles from './MaterialManagement.module.scss'
import appShellStyles from '../../styles/app-shell.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { Button, Empty, Input, Tree } from 'antd'
import type { TreeDataNode } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import ChevronDownIcon from '@unilab/design-v2/icons/static/arrows/chevron-down'
import ChevronRightIcon from '@unilab/design-v2/icons/static/arrows/chevron-right'
import { projectMaterialInspection, type MaterialGraphNode } from '@unilab-fe/core'
import { MaterialInspector as LabMaterialInspector } from '@unilab/lab-ui'
import { AppIcon } from '../../components/ui/Icon'
import { PageHeader } from '../../components/ui/PageHeader'

export function MaterialManagement({
  graph,
  onBack,
}: {
  graph?: import('@unilab-fe/core').MaterialGraph
  onBack: () => void
}) {
  const [selected, setSelected] = useState<string | undefined>(
    graph?.nodes[0]?.material.materialUuid,
  )
  const [keyword, setKeyword] = useState('')
  const normalizedKeyword = keyword.trim().toLowerCase()
  // 图还没加载/加载失败时也必须给出稳定引用：`?? []` 每次渲染都是新数组，
  // 会让 nodes/treeData 与下面的 effect 每次都变化，触发 React 的无限更新保护
  // （表现为刚点开「物料管理」就整页空白）。
  const allNodes = useMemo(() => graph?.nodes ?? [], [graph])
  const nodes = useMemo(
    () => filterMaterialNodes(allNodes, normalizedKeyword),
    [allNodes, normalizedKeyword],
  )
  const node = nodes.find((item) => item.material.materialUuid === selected) ?? nodes[0]
  const inspection = useMemo(
    () =>
      graph && node
        ? projectMaterialInspection(graph, {
            kind: 'node',
            materialUuid: node.material.materialUuid,
          })
        : undefined,
    [graph, node],
  )
  const treeData = useMemo(() => buildTree(nodes), [nodes])
  const [expandedKeys, setExpandedKeys] = useState<string[]>([])
  useEffect(() => {
    const next = normalizedKeyword ? collectExpandableKeys(treeData) : EMPTY_EXPANDED_KEYS
    // 内容没变就不写 state：即使 deps 因外部引用变化重跑，也不能制造新数组。
    setExpandedKeys((current) => (sameKeys(current, next) ? current : next))
  }, [treeData, normalizedKeyword])
  return (
    <div
      className={clsx(
        appShellStyles['page-stack'],
        sharedStyles['page-stack'],
        materialManagementStyles['material-management-page'],
        appShellStyles['material-management-page'],
      )}
    >
      <PageHeader
        leading={
          <Button
            type="text"
            className={clsx(sharedStyles['page-header-back'])}
            aria-label="返回物料关系图"
            title="返回物料关系图"
            icon={<AppIcon name="arrows/arrow-left" size={18} />}
            onClick={onBack}
          />
        }
        title="物料管理"
      />
      <div
        className={clsx(
          materialManagementStyles['management-workspace'],
          sharedStyles['management-workspace'],
        )}
      >
        <section
          className={clsx(
            materialManagementStyles['management-tree'],
            sharedStyles['management-tree'],
          )}
        >
          <Input
            allowClear
            prefix={<AppIcon name="general/search-md" size={16} />}
            placeholder="搜索物料"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Tree
            className={clsx(materialManagementStyles['resource-tree'])}
            blockNode
            expandedKeys={expandedKeys}
            selectedKeys={selected ? [selected] : []}
            switcherIcon={({ expanded, isLeaf }) =>
              isLeaf ? null : expanded ? (
                <ChevronDownIcon size={14} color="inherit" />
              ) : (
                <ChevronRightIcon size={14} color="inherit" />
              )
            }
            treeData={treeData}
            onExpand={(keys) => setExpandedKeys(keys.map(String))}
            onSelect={(keys) => setSelected(keys[0] as string)}
          />
        </section>
        {inspection ? (
          <LabMaterialInspector projection={inspection} onSelectOccupiedMaterial={setSelected} />
        ) : (
          <Empty description="没有匹配的物料" />
        )}
      </div>
    </div>
  )
}

function buildTree(nodes: readonly MaterialGraphNode[]): TreeDataNode[] {
  const byParent = new Map<string | null, MaterialGraphNode[]>()
  nodes.forEach((node) => {
    const parent = node.material.parentMaterialUuid
    byParent.set(parent, [...(byParent.get(parent) ?? []), node])
  })
  const toTree = (parent: string | null): TreeDataNode[] =>
    (byParent.get(parent) ?? []).map((node) => ({
      key: node.material.materialUuid,
      title: node.material.name,
      children: toTree(node.material.materialUuid),
    }))
  return toTree(null)
}

function filterMaterialNodes(
  nodes: readonly MaterialGraphNode[],
  keyword: string,
): MaterialGraphNode[] {
  if (!keyword) return [...nodes]
  const byId = new Map(nodes.map((node) => [node.material.materialUuid, node]))
  const included = new Set<string>()
  for (const node of nodes) {
    const matches = `${node.material.name} ${node.material.barcode ?? ''}`
      .toLowerCase()
      .includes(keyword)
    if (!matches) continue
    let current: MaterialGraphNode | undefined = node
    const visited = new Set<string>()
    while (current && !visited.has(current.material.materialUuid)) {
      const id = current.material.materialUuid
      visited.add(id)
      included.add(id)
      current = current.material.parentMaterialUuid
        ? byId.get(current.material.parentMaterialUuid)
        : undefined
    }
  }
  return nodes.filter((node) => included.has(node.material.materialUuid))
}

function collectExpandableKeys(treeData: readonly TreeDataNode[]): string[] {
  return treeData.flatMap((node) => [
    ...(node.children?.length ? [String(node.key)] : []),
    ...collectExpandableKeys(node.children ?? []),
  ])
}

/** 空展开集必须是同一个常量引用，避免每次渲染都产生新数组。 */
const EMPTY_EXPANDED_KEYS: string[] = []

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index])
}
