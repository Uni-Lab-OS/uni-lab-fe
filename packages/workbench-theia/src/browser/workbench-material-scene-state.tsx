import type { MaterialSceneReadiness } from '@unilab/material'
import * as React from 'react'

interface WorkbenchMaterialSceneStateProps {
  kind: 'empty' | 'error' | 'list-only'
  readiness?: MaterialSceneReadiness
  error?: string | null
  onRetry?: () => void
}

/**
 * 显示物料场景的空、失败或仅列表降级状态，不伪造缺失的空间关系。
 * @param props 当前状态、物料图计数、错误原因与可选恢复动作。
 * @returns 可访问、可行动的 Workbench 物料场景状态。
 */
export function WorkbenchMaterialSceneState({
  kind,
  readiness,
  error,
  onRetry
}: WorkbenchMaterialSceneStateProps): React.JSX.Element {
  const content = materialSceneStateContent(kind, readiness)
  return (
    <section
      className="unilab-workbench-material-state"
      data-material-scene-state={kind}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
    >
      <span className={`codicon ${content.icon}`} aria-hidden="true" />
      <div>
        <strong>{content.title}</strong>
        <p>{content.description}</p>
        {readiness && readiness.materialCount > 0 ? (
          <dl aria-label="物料空间数据摘要">
            <div><dt>物料</dt><dd>{readiness.materialCount}</dd></div>
            <div><dt>已定位</dt><dd>{readiness.positionedMaterialCount}</dd></div>
            <div><dt>库位</dt><dd>{readiness.siteCount}</dd></div>
          </dl>
        ) : null}
        {error ? <code>{error}</code> : null}
        {onRetry ? (
          <button type="button" onClick={onRetry}>重新读取物料图</button>
        ) : null}
      </div>
    </section>
  )
}

/**
 * 提示 2.5D 正在使用尺寸包围盒降级，空间事实仍由物料图提供。
 * @returns 不遮挡视图控制的非模态状态条。
 */
export function WorkbenchMaterialShapeFallbackNotice(): React.JSX.Element {
  return (
    <div
      className="unilab-workbench-material-shape-notice"
      role="status"
    >
      <span className="codicon codicon-info" aria-hidden="true" />
      <span>
        当前服务未提供可用的 2.5D 外形声明；2.5D 将按真实尺寸显示基础包围盒。
      </span>
    </div>
  )
}

/** 将物料场景状态转换为面向操作员的事实说明。 */
function materialSceneStateContent(
  kind: WorkbenchMaterialSceneStateProps['kind'],
  readiness: MaterialSceneReadiness | undefined
): { title: string; description: string; icon: string } {
  if (kind === 'error') {
    return {
      title: '物料场景加载失败',
      description: '未能读取当前服务的物料图。请检查连接后重新读取。',
      icon: 'codicon-error'
    }
  }
  if (kind === 'empty') {
    return {
      title: '暂无物料',
      description: '当前服务返回的物料图为空；左侧目录可用于查看或创建物料。',
      icon: 'codicon-beaker'
    }
  }
  return {
    title: '空间视图暂不可用',
    description: readiness?.materialCount
      ? `已读取 ${readiness.materialCount} 项物料，但没有世界坐标、父子放置或库位放置。左侧物料列表仍可查看；2D、2.5D、3D 与分屏已停用。`
      : '当前物料图未提供可用空间关系；左侧物料列表仍可查看。',
    icon: 'codicon-warning'
  }
}
