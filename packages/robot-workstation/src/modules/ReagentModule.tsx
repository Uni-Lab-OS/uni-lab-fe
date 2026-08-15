import { useMemo, useState } from 'react'
import { Button, Input } from '@unilab/design-system'

import { DataAuthorityNotice, ModuleHeader, WorkstationDataState } from '../ModuleHeader'
import { BackendReagentDeleteDialog, BackendReagentEditorDialog } from '../reagents/BackendReagentDialogs'
import { BackendReagentHistory } from '../reagents/BackendReagentHistory'
import { ReagentInfoDeleteDialog, ReagentInfoEditorDialog } from '../reagents/ReagentInfoDialogs'
import { ReagentLedgerView, ReagentLibraryView } from '../reagents/ReagentViews'
import type {
  ReagentCreateCommand,
  ReagentInfoCreateCommand,
  ReagentInfoManagement,
  ReagentInfoProjection,
  ReagentInfoUpdateCommand,
  ReagentInventoryProjection,
  ReagentManagement,
  ReagentUpdateCommand,
  WorkstationDataStatus
} from '../types'
import { uiClass } from '../uiClasses'
import { WorkstationIcon } from '../WorkstationIcon'
import styles from '../workstation.module.scss'

type ReagentDialog =
  | { kind: 'create' }
  | { kind: 'edit'; id: string }
  | { kind: 'delete'; id: string }
  | { kind: 'info-create' }
  | { kind: 'info-edit'; id: string }
  | { kind: 'info-delete'; id: string }
  | null

type ReagentView = 'ledger' | 'library'

/**
 * 展示真实试剂台账与 Backend 试剂基础信息库，并在能力可用时提供实例 CRUD。
 * @param props 权威台账、基础信息、加载状态和可选 Backend 管理端口。
 * @returns 与附件信息架构一致、无前端夹具的试剂管理表面。
 */
export function ReagentModule({
  items,
  status,
  infos,
  infoStatus,
  management,
  infoManagement
}: {
  items?: readonly ReagentInventoryProjection[]
  status: WorkstationDataStatus
  infos?: readonly ReagentInfoProjection[]
  infoStatus: WorkstationDataStatus
  management?: ReagentManagement
  infoManagement?: ReagentInfoManagement
}): React.JSX.Element {
  const [view, setView] = useState<ReagentView>('ledger')
  const [ledgerQuery, setLedgerQuery] = useState('')
  const [libraryQuery, setLibraryQuery] = useState('')
  const [dialog, setDialog] = useState<ReagentDialog>(null)
  const [historyId, setHistoryId] = useState<string>()
  const [feedback, setFeedback] = useState('')
  const createReady = Boolean(
    management &&
    status.phase === 'ready' &&
    management.containerStatus.phase === 'ready'
  )
  const infoCreateReady = Boolean(infoManagement && infoStatus.phase === 'ready')
  const retry = view === 'ledger' ? status.retry : infoStatus.retry
  const query = view === 'ledger' ? ledgerQuery : libraryQuery
  const setQuery = view === 'ledger' ? setLedgerQuery : setLibraryQuery

  /** 创建提交成功后关闭模态框并等待列表和目录权威回读。 */
  async function createReagent(command: ReagentCreateCommand): Promise<void> {
    if (!management) return
    await management.create(command)
    setDialog(null)
    setFeedback('库存试剂已登记，正在刷新列表。')
  }

  /** 更新提交成功后关闭模态框；界面不在本地推进修订或数量。 */
  async function updateReagent(command: ReagentUpdateCommand): Promise<void> {
    if (!management) return
    await management.update(command)
    setDialog(null)
    setFeedback('库存信息已保存，正在刷新列表。')
  }

  /** 删除提交成功后清理详情选择，并等待 Backend 软删除后的台账。 */
  async function deleteReagent(item: ReagentInventoryProjection): Promise<void> {
    if (!management) return
    await management.delete(item.id)
    if (historyId === item.id) setHistoryId(undefined)
    setDialog(null)
    setFeedback('库存试剂已删除，余量变更已记录。')
  }

  /** 手工登记化学品身份后关闭表单，并等待 Backend 目录权威回读。 */
  async function createReagentInfo(command: ReagentInfoCreateCommand): Promise<void> {
    if (!infoManagement) return
    await infoManagement.create(command)
    setDialog(null)
    setFeedback('试剂身份已创建，正在刷新身份库。')
  }

  /** 纠错化学品身份后不在本地改行，统一等待 Backend 返回最新目录。 */
  async function updateReagentInfo(command: ReagentInfoUpdateCommand): Promise<void> {
    if (!infoManagement) return
    await infoManagement.update(command)
    setDialog(null)
    setFeedback('试剂身份已更新，正在刷新身份库。')
  }

  /** 删除未被引用的误建身份；成功前不从目录乐观移除。 */
  async function deleteReagentInfo(item: ReagentInfoProjection): Promise<void> {
    if (!infoManagement) return
    await infoManagement.delete(item.id)
    setDialog(null)
    setFeedback('试剂身份已删除，正在刷新身份库。')
  }

  return (
    <div className={uiClass.modulePage} data-testid="workstation-reagents">
      <ModuleHeader
        title="试剂管理"
        description="维护试剂身份与库存实例；预留、扣减和位置变化由系统统一记录。"
        actions={(
          <>
            {view === 'ledger' && management ? (
              <Button
                size="sm"
                disabled={!createReady}
                title={createReady ? '登记库存试剂' : management.containerStatus.message}
                onClick={() => setDialog({ kind: 'create' })}
                data-testid="reagent-create"
              >
                <WorkstationIcon name="plus" />
                登记库存
              </Button>
            ) : null}
            {view === 'library' && infoManagement ? (
              <Button
                size="sm"
                disabled={!infoCreateReady}
                title={infoCreateReady ? '新建试剂身份' : infoStatus.message}
                onClick={() => setDialog({ kind: 'info-create' })}
                data-testid="reagent-info-create"
              >
                <WorkstationIcon name="plus" />
                新建身份
              </Button>
            ) : null}
            {retry ? (
              <Button variant="outline" size="sm" onClick={retry}>刷新数据</Button>
            ) : null}
          </>
        )}
      />

      <div className={styles.reagentViewToolbar}>
        <nav className={styles.reagentNavigation} aria-label="试剂管理功能" role="tablist">
          <Button
            variant="ghost"
            size="sm"
            role="tab"
            aria-selected={view === 'ledger'}
            aria-controls="reagent-ledger-panel"
            onClick={() => setView('ledger')}
          >库存试剂</Button>
          <Button
            variant="ghost"
            size="sm"
            role="tab"
            aria-selected={view === 'library'}
            aria-controls="reagent-library-panel"
            onClick={() => setView('library')}
          >试剂身份</Button>
        </nav>
        <label className={styles.searchField}>
          <WorkstationIcon name="search" />
          <span className={uiClass.screenReaderOnly}>{view === 'ledger' ? '搜索库存试剂' : '搜索试剂身份'}</span>
          <Input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={view === 'ledger' ? '搜索名称、CAS、容器或库位' : '搜索名称、别名、CAS 或分子式'}
          />
        </label>
      </div>

      <ReagentLedgerSurface
        hidden={view !== 'ledger'}
        items={items}
        status={status}
        infos={infos}
        infoStatus={infoStatus}
        management={management}
        infoManagement={infoManagement}
        query={query}
        feedback={feedback}
        historyId={historyId}
        onDialog={setDialog}
        onHistory={setHistoryId}
      />
      <ReagentLibrarySurface
        hidden={view !== 'library'}
        infos={infos}
        status={infoStatus}
        query={query}
        management={infoManagement}
        feedback={feedback}
        onDialog={setDialog}
      />
      <ReagentDialogLayer
        dialog={dialog}
        items={items}
        infos={infos}
        management={management}
        infoManagement={infoManagement}
        onCreate={createReagent}
        onUpdate={updateReagent}
        onDelete={deleteReagent}
        onInfoCreate={createReagentInfo}
        onInfoUpdate={updateReagentInfo}
        onInfoDelete={deleteReagentInfo}
        onClose={() => setDialog(null)}
      />
    </div>
  )
}

/**
 * 渲染试剂台账的加载、空态、列表与历史面板。
 * @param props 当前显隐、权威库存、搜索词和实例操作回调。
 * @returns 单一台账 tabpanel。
 */
function ReagentLedgerSurface({
  hidden,
  items,
  status,
  infos,
  infoStatus,
  management,
  infoManagement,
  query,
  feedback,
  historyId,
  onDialog,
  onHistory
}: {
  hidden: boolean
  items?: readonly ReagentInventoryProjection[]
  status: WorkstationDataStatus
  infos?: readonly ReagentInfoProjection[]
  infoStatus: WorkstationDataStatus
  management?: ReagentManagement
  infoManagement?: ReagentInfoManagement
  query: string
  feedback: string
  historyId?: string
  onDialog: (dialog: ReagentDialog) => void
  onHistory: (id?: string) => void
}): React.JSX.Element {
  const historyItem = items?.find(item => item.id === historyId)
  const emptyAction = infoStatus.phase === 'ready' && infos
    ? infos.length > 0 && management
      ? (
          <Button
            data-testid="reagent-empty-primary"
            disabled={management.containerStatus.phase !== 'ready'}
            title={management.containerStatus.phase === 'ready'
              ? '登记库存试剂'
              : management.containerStatus.message}
            onClick={() => onDialog({ kind: 'create' })}
          >登记库存</Button>
        )
      : infos.length === 0 && infoManagement
        ? (
            <Button
              data-testid="reagent-empty-primary"
              onClick={() => onDialog({ kind: 'info-create' })}
            >新建试剂身份</Button>
          )
        : undefined
    : undefined
  return (
    <section id="reagent-ledger-panel" role="tabpanel" hidden={hidden}>
      {status.phase !== 'ready' || !items ? (
        <WorkstationDataState status={status} title={reagentStateTitle(status)} icon="flask" />
      ) : (
        <>
          {!management ? (
            <DataAuthorityNotice>
              当前库存为只读；数据源未提供的字段显示为“—”。
            </DataAuthorityNotice>
          ) : null}
          {items.length === 0 ? (
            <WorkstationDataState
              status={{
                phase: 'empty',
                message: management
                  ? '当前没有库存试剂。请选择试剂身份和空容器完成登记。'
                  : '当前数据源没有可展示的库存试剂。',
                retry: status.retry
              }}
              title="暂无库存试剂"
              icon="flask"
              action={emptyAction}
            />
          ) : (
            <ReagentLedgerView
              items={items}
              query={query}
              actions={management ? {
                edit: item => onDialog({ kind: 'edit', id: item.id }),
                history: item => onHistory(item.id),
                delete: item => onDialog({ kind: 'delete', id: item.id })
              } : undefined}
            />
          )}
          {feedback ? <p className={styles.feedbackLine} role="status">{feedback}</p> : null}
          {historyItem && management ? (
            <BackendReagentHistory
              key={historyItem.id}
              item={historyItem}
              readHistory={management.readHistory}
              onClose={() => onHistory(undefined)}
            />
          ) : null}
        </>
      )}
    </section>
  )
}

/**
 * 渲染试剂基础信息库的加载、空态、目录与可选 Backend 操作。
 * @param props 当前显隐、权威目录、接口状态、搜索词和管理回调。
 * @returns 单一试剂库 tabpanel。
 */
function ReagentLibrarySurface({
  hidden,
  infos,
  status,
  query,
  management,
  feedback,
  onDialog
}: {
  hidden: boolean
  infos?: readonly ReagentInfoProjection[]
  status: WorkstationDataStatus
  query: string
  management?: ReagentInfoManagement
  feedback: string
  onDialog: (dialog: ReagentDialog) => void
}): React.JSX.Element {
  return (
    <section id="reagent-library-panel" role="tabpanel" hidden={hidden}>
      {status.phase !== 'ready' || !infos ? (
        <WorkstationDataState status={status} title={reagentInfoStateTitle(status)} icon="flask" />
      ) : infos.length === 0 ? (
        <WorkstationDataState
          status={{
            phase: 'empty',
            message: management
              ? '当前还没有试剂身份。创建身份后即可登记库存试剂。'
              : '当前数据源没有可展示的试剂身份。',
            retry: status.retry
          }}
          title="暂无试剂身份"
          icon="flask"
        />
      ) : (
        <>
          {!management ? (
            <DataAuthorityNotice>
              当前身份库为只读，库存和历史数据不会在浏览器中另存副本。
            </DataAuthorityNotice>
          ) : null}
          <ReagentLibraryView
            infos={infos}
            query={query}
            actions={management ? {
              edit: item => onDialog({ kind: 'info-edit', id: item.id }),
              delete: item => onDialog({ kind: 'info-delete', id: item.id })
            } : undefined}
          />
          {feedback ? <p className={styles.feedbackLine} role="status">{feedback}</p> : null}
        </>
      )}
    </section>
  )
}

/**
 * 根据当前命令只挂载一个 Backend 试剂实例对话框。
 * @param props 当前命令、库存、管理端口及提交/关闭回调。
 * @returns 创建、编辑、删除对话框或空片段。
 */
function ReagentDialogLayer({
  dialog,
  items,
  infos,
  management,
  infoManagement,
  onCreate,
  onUpdate,
  onDelete,
  onInfoCreate,
  onInfoUpdate,
  onInfoDelete,
  onClose
}: {
  dialog: ReagentDialog
  items?: readonly ReagentInventoryProjection[]
  infos?: readonly ReagentInfoProjection[]
  management?: ReagentManagement
  infoManagement?: ReagentInfoManagement
  onCreate: (command: ReagentCreateCommand) => Promise<void>
  onUpdate: (command: ReagentUpdateCommand) => Promise<void>
  onDelete: (item: ReagentInventoryProjection) => Promise<void>
  onInfoCreate: (command: ReagentInfoCreateCommand) => Promise<void>
  onInfoUpdate: (command: ReagentInfoUpdateCommand) => Promise<void>
  onInfoDelete: (item: ReagentInfoProjection) => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const dialogItem = dialog && (dialog.kind === 'edit' || dialog.kind === 'delete')
    ? items?.find(item => item.id === dialog.id)
    : undefined
  const dialogInfo = dialog && (dialog.kind === 'info-edit' || dialog.kind === 'info-delete')
    ? infos?.find(info => info.id === dialog.id)
    : undefined
  const occupiedMaterialIds = useMemo(
    () => new Set((items ?? []).flatMap(item => item.materialId ? [item.materialId] : [])),
    [items]
  )
  if (dialog?.kind === 'create' && management?.containers) {
    return (
      <BackendReagentEditorDialog
        mode="create"
        containers={management.containers}
        infos={infos}
        occupiedMaterialIds={occupiedMaterialIds}
        onSave={onCreate}
        onClose={onClose}
      />
    )
  }
  if (dialog?.kind === 'edit' && dialogItem && management) {
    return (
      <BackendReagentEditorDialog
        mode="edit"
        item={dialogItem}
        containers={management.containers ?? []}
        occupiedMaterialIds={occupiedMaterialIds}
        onSave={onUpdate}
        onClose={onClose}
      />
    )
  }
  if (dialog?.kind === 'delete' && dialogItem && management) {
    return (
      <BackendReagentDeleteDialog
        item={dialogItem}
        onDelete={() => onDelete(dialogItem)}
        onClose={onClose}
      />
    )
  }
  if (dialog?.kind === 'info-create' && infoManagement) {
    return (
      <ReagentInfoEditorDialog
        mode="create"
        onLookup={infoManagement.lookupByCAS}
        onSave={onInfoCreate}
        onClose={onClose}
      />
    )
  }
  if (dialog?.kind === 'info-edit' && dialogInfo && infoManagement) {
    return (
      <ReagentInfoEditorDialog
        mode="edit"
        item={dialogInfo}
        onLookup={infoManagement.lookupByCAS}
        onSave={onInfoUpdate}
        onClose={onClose}
      />
    )
  }
  if (dialog?.kind === 'info-delete' && dialogInfo && infoManagement) {
    return (
      <ReagentInfoDeleteDialog
        item={dialogInfo}
        onDelete={() => onInfoDelete(dialogInfo)}
        onClose={onClose}
      />
    )
  }
  return <></>
}

/** 返回试剂台账接口状态的简短标题。 */
function reagentStateTitle(status: WorkstationDataStatus): string {
  if (status.phase === 'loading') return '正在读取库存试剂'
  if (status.phase === 'error') return '库存试剂读取失败'
  if (status.phase === 'unavailable') return '库存试剂暂不可用'
  return '暂无库存试剂'
}

/** 返回试剂基础信息接口状态的简短标题。 */
function reagentInfoStateTitle(status: WorkstationDataStatus): string {
  if (status.phase === 'loading') return '正在读取试剂身份'
  if (status.phase === 'error') return '试剂身份读取失败'
  if (status.phase === 'unavailable') return '试剂身份暂不可用'
  return '暂无试剂身份'
}
