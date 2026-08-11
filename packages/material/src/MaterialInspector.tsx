import { SlideOverDrawer } from '@unilab/design-system'
import { useEffect, useMemo, useState } from 'react'

import type { CapabilityStatus } from './MaterialCapabilityNotice'
import { MaterialEditForm } from './MaterialEditForm'
import {
  collectMaterialSubtreeIds,
  materialCrudErrorMessage,
  materialPlacementLabel
} from './materialCrud'
import {
  useMaterialStore,
  useMaterialStoreApi
} from './MaterialStoreProvider'
import { materialScopeClassName } from './materialStyles'
import type {
  MaterialAggregate,
  MaterialId,
  UpdateMaterialConfigCommand
} from './types'

type MaterialInspectorMode = 'view' | 'edit' | 'delete'

export interface MaterialInspectorProps {
  materialId: MaterialId | null
  initialMode?: Exclude<MaterialInspectorMode, 'delete'>
  configSchema?: Record<string, unknown>
  updateStatus: CapabilityStatus
  deleteStatus: CapabilityStatus
  onRequestPlacement?: () => void
  onClose: () => void
  onDeleted?: () => void
}

/**
 * 展示并维护一个物料聚合的身份、配置和受保护删除入口。
 * @param props 选中物料、写能力状态与关闭/删除后的选择回调。
 * @returns 由物料服务端口驱动的属性抽屉，不产生乐观权威状态。
 */
export function MaterialInspector({
  materialId,
  initialMode = 'view',
  configSchema,
  updateStatus,
  deleteStatus,
  onRequestPlacement,
  onClose,
  onDeleted
}: MaterialInspectorProps): React.JSX.Element {
  const store = useMaterialStoreApi()
  const aggregate = useMaterialStore((state) =>
    materialId ? state.aggregatesById[materialId] : undefined
  )
  const childrenByParentId = useMaterialStore(
    (state) => state.graphIndex.childrenByParentId
  )
  const pending = useMaterialStore((state) =>
    Object.values(state.pendingCommandsById).some((command) =>
      materialId ? command.materialIds.includes(materialId) : false
    )
  )
  const [mode, setMode] = useState<MaterialInspectorMode>(initialMode)
  const [operationError, setOperationError] = useState<string | null>(null)

  useEffect(() => {
    setMode(initialMode)
    setOperationError(null)
  }, [initialMode, materialId])

  const subtreeIds = useMemo(
    () =>
      materialId
        ? collectMaterialSubtreeIds(materialId, childrenByParentId)
        : [],
    [childrenByParentId, materialId]
  )
  const managedByParent =
    aggregate?.material.component?.managedByParent === true
  const effectiveDeleteStatus = managedByParent
    ? {
        available: false,
        reason: '该物料由父物料管理，请从父物料执行子树删除'
      }
    : deleteStatus

  /**
   * 提交物料名称、说明和配置更新，并等待服务端权威聚合返回。
   * @param patch 用户确认并通过校验的配置补丁。
   * @returns 服务端确认后结束；失败时保留编辑内容并显示原因。
   */
  const save = async (
    patch: UpdateMaterialConfigCommand['patch']
  ): Promise<void> => {
    if (!materialId) return
    setOperationError(null)
    try {
      await store.getState().updateConfig(materialId, patch)
      setMode('view')
    } catch (error) {
      setOperationError(materialCrudErrorMessage(error))
    }
  }

  /**
   * 请求物料权威删除当前物料子树，并在确认后清理跨面板选择。
   * @returns 删除成功后结束；失败时保持确认界面和原有物料投影。
   */
  const remove = async (): Promise<void> => {
    if (!materialId) return
    setOperationError(null)
    try {
      await store.getState().deleteSubtree(materialId)
      onDeleted?.()
    } catch (error) {
      setOperationError(materialCrudErrorMessage(error))
    }
  }

  return (
    <SlideOverDrawer
      open={materialId !== null}
      title={
        <span
          className={materialScopeClassName(
            'material-inspector__drawer-title'
          )}
        >
          <strong>
            {mode === 'edit'
              ? '编辑物料'
              : mode === 'delete'
                ? '删除物料'
                : '物料属性'}
          </strong>
          {aggregate ? <small>{aggregate.material.name}</small> : null}
        </span>
      }
      ariaLabel="物料属性"
      closeLabel="关闭物料属性"
      onClose={onClose}
    >
      <aside className={materialScopeClassName('material-inspector')}>
        {!aggregate ? (
          <p>选择 2D 或 3D 中的物料查看详情</p>
        ) : mode === 'edit' ? (
          <MaterialEditForm
            key={`${aggregate.material.id}:${aggregate.revision}`}
            aggregate={aggregate}
            configSchema={configSchema}
            status={updateStatus}
            pending={pending}
            error={operationError}
            onCancel={() => {
              setOperationError(null)
              setMode('view')
            }}
            onSave={save}
          />
        ) : mode === 'delete' ? (
          <MaterialDeleteConfirmation
            aggregate={aggregate}
            status={effectiveDeleteStatus}
            subtreeIds={subtreeIds}
            pending={pending}
            error={operationError}
            onCancel={() => {
              setOperationError(null)
              setMode('view')
            }}
            onConfirm={remove}
          />
        ) : (
          <MaterialInspectorOverview
            aggregate={aggregate}
            updateStatus={updateStatus}
            deleteStatus={effectiveDeleteStatus}
            subtreeSize={subtreeIds.length}
            pending={pending}
            onEdit={() => setMode('edit')}
            onDelete={() => setMode('delete')}
            onRequestPlacement={onRequestPlacement}
          />
        )}
      </aside>
    </SlideOverDrawer>
  )
}

/**
 * 展示物料稳定身份、放置事实和当前写能力。
 * @param props 当前聚合、能力状态、子树规模和模式切换回调。
 * @returns 物料只读概览。
 */
export function MaterialInspectorOverview({
  aggregate,
  updateStatus,
  deleteStatus,
  subtreeSize,
  pending,
  onEdit,
  onDelete,
  onRequestPlacement
}: {
  aggregate: MaterialAggregate
  updateStatus: CapabilityStatus
  deleteStatus: CapabilityStatus
  subtreeSize: number
  pending: boolean
  onEdit: () => void
  onDelete: () => void
  onRequestPlacement?: () => void
}): React.JSX.Element {
  return (
    <div className="material-inspector__content">
      <div className="material-inspector__identity">
        <span aria-hidden="true">
          <MaterialIdentityIcon />
        </span>
        <div>
          <small>当前物料</small>
          <strong>{aggregate.material.name}</strong>
          <code>{aggregate.material.code || '未设置代码'}</code>
        </div>
      </div>

      <div className="material-inspector__actions" aria-label="物料操作">
        <button
          type="button"
          disabled={pending}
          title={updateStatus.reason}
          onClick={onEdit}
        >
          <EditIcon />
          编辑
        </button>
        <button
          type="button"
          className="is-danger"
          disabled={pending}
          title={deleteStatus.reason}
          onClick={onDelete}
        >
          <DeleteIcon />
          删除
        </button>
      </div>

      <dl>
        <dt>名称</dt>
        <dd>{aggregate.material.name}</dd>
        <dt>代码</dt>
        <dd>{aggregate.material.code || '—'}</dd>
        <dt>模板</dt>
        <dd>{aggregate.material.sourceTemplateId}</dd>
        <dt>放置方式</dt>
        <dd>{materialPlacementLabel(aggregate.placement.kind)}</dd>
        <dt>子树规模</dt>
        <dd>{subtreeSize} 个物料实例</dd>
        <dt>修订版本</dt>
        <dd>{aggregate.revision}</dd>
      </dl>
      <h3>配置</h3>
      <pre>{JSON.stringify(aggregate.material.config, null, 2)}</pre>

      {onRequestPlacement ? (
        <section className="material-inspector__next-step">
          <small>下一步 · 存储位置</small>
          <strong>
            {aggregate.placement.kind === 'unplaced'
              ? '当前实例尚未放置'
              : '查看或调整实例位置'}
          </strong>
          <p>
            创建和参数保存不会自动改变库位占用；请在位置页选择稳定库位并确认。
          </p>
          <button type="button" onClick={onRequestPlacement}>
            {aggregate.placement.kind === 'unplaced'
              ? '设置存储位置'
              : '前往位置页'}
          </button>
        </section>
      ) : null}

      {!updateStatus.available || !deleteStatus.available ? (
        <div className="material-inspector__capabilities">
          <strong>当前写入能力</strong>
          <CapabilityRow label="编辑" status={updateStatus} />
          <CapabilityRow label="删除" status={deleteStatus} />
        </div>
      ) : null}
    </div>
  )
}

/**
 * 要求用户复核子树规模并输入物料名称后才允许提交删除。
 * @param props 当前物料、权威能力、子树身份和确认回调。
 * @returns 关闭失败的危险操作确认面板。
 */
function MaterialDeleteConfirmation({
  aggregate,
  status,
  subtreeIds,
  pending,
  error,
  onCancel,
  onConfirm
}: {
  aggregate: MaterialAggregate
  status: CapabilityStatus
  subtreeIds: readonly MaterialId[]
  pending: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => Promise<void>
}): React.JSX.Element {
  const [confirmation, setConfirmation] = useState('')
  const confirmed = confirmation === aggregate.material.name

  return (
    <div className="material-inspector__delete">
      <div className="material-inspector__danger-heading">
        <span aria-hidden="true">
          <DeleteIcon />
        </span>
        <div>
          <strong>删除物料子树</strong>
          <p>该操作不能在前端撤销。</p>
        </div>
      </div>
      <dl>
        <dt>目标物料</dt>
        <dd>{aggregate.material.name}</dd>
        <dt>稳定身份</dt>
        <dd>
          <code>{aggregate.material.id}</code>
        </dd>
        <dt>影响范围</dt>
        <dd>{subtreeIds.length} 个物料实例</dd>
      </dl>
      <p>
        物料权威会再次校验任务物料预留、作业执行占用和库位占用；任何条件不允许时，整次删除均不会提交。
      </p>
      <label>
        <span>输入“{aggregate.material.name}”确认</span>
        <input
          value={confirmation}
          disabled={!status.available || pending}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="off"
          autoFocus
        />
      </label>
      {!status.available ? (
        <p className="material-inspector__notice">{status.reason}</p>
      ) : null}
      {error ? (
        <p className="material-inspector__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="material-inspector__form-actions">
        <button type="button" onClick={onCancel} disabled={pending}>
          返回
        </button>
        <button
          type="button"
          className="is-danger"
          disabled={!status.available || !confirmed || pending}
          onClick={() => void onConfirm()}
        >
          {pending ? '正在删除…' : '确认删除'}
        </button>
      </div>
    </div>
  )
}

/** 展示单项服务能力及其关闭失败原因。 */
function CapabilityRow({
  label,
  status
}: {
  label: string
  status: CapabilityStatus
}): React.JSX.Element {
  return (
    <div>
      <span>{label}</span>
      <small className={status.available ? 'is-available' : undefined}>
        {status.available ? '可用' : status.reason ?? '当前不可用'}
      </small>
    </div>
  )
}

/** 返回物料身份图标。 */
function MaterialIdentityIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v8.5" />
    </svg>
  )
}

/** 返回编辑动作图标。 */
function EditIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18">
      <path d="m4 12.7-.7 2 2-.7 8.2-8.2-1.3-1.3L4 12.7Z" />
      <path d="m10.8 5.9 1.3 1.3" />
    </svg>
  )
}

/** 返回删除动作图标。 */
function DeleteIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18">
      <path d="M3.5 5h11M7 3.5h4M5.5 5l.6 9h5.8l.6-9M7.7 7.5v4M10.3 7.5v4" />
    </svg>
  )
}
