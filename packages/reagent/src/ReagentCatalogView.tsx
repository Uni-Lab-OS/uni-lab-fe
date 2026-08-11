import {
  useEffect,
  useState,
  type FormEvent
} from 'react'

import type { MaterialId } from '@unilab/material'

import type { CapabilityStatus } from './reagentWorkspace'
import {
  normalizeReagentCustomFields,
  ReagentCustomFieldDetails,
  ReagentCustomFieldEditor,
  validateReagentCustomFields
} from './ReagentCustomFields'
import { ReagentHistoryPanel } from './ReagentHistoryPanel'
import { ReagentContainerLedger } from './ReagentWorkspaceViews'
import {
  type ReagentCatalogGroup,
  type ReagentHistoryEvent,
  type ReagentInfoProjection
} from './reagentWorkspace'

export interface ReagentCatalogViewProps {
  groups: readonly ReagentCatalogGroup[]
  selectedInfoId: string | null
  selectedMaterialIds: readonly MaterialId[]
  readStatus: CapabilityStatus
  inventoryStatus: CapabilityStatus
  updateStatus: CapabilityStatus
  historyStatus: CapabilityStatus
  historyEvents: readonly ReagentHistoryEvent[]
  onSelectContainer: (materialId: MaterialId) => void
  onRequestCreate: () => void
  onUpdateInfo?: (input: ReagentInfoProjection) => Promise<void>
}

/**
 * 以单一容器表、结构化筛选和试剂详情组织统一试剂台账。
 * @param props 试剂目录投影、选择状态、信息写能力与操作回调。
 * @returns 可下钻到具体 Material 容器并结构化维护试剂信息的台账页。
 */
export function ReagentCatalogView({
  groups,
  selectedInfoId,
  selectedMaterialIds,
  readStatus,
  inventoryStatus,
  updateStatus,
  historyStatus,
  historyEvents,
  onSelectContainer,
  onRequestCreate,
  onUpdateInfo
}: ReagentCatalogViewProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [activeInfoId, setActiveInfoId] = useState(selectedInfoId)
  const activeGroup = groups.find((group) => (
    group.reagentInfo.id === activeInfoId
  )) ?? groups[0] ?? null

  useEffect(() => {
    if (!activeGroup || activeGroup.reagentInfo.id === activeInfoId) return
    setActiveInfoId(activeGroup.reagentInfo.id)
  }, [activeGroup, activeInfoId])

  useEffect(() => {
    if (!selectedInfoId || selectedInfoId === activeInfoId) return
    if (!groups.some((group) => group.reagentInfo.id === selectedInfoId)) return
    setActiveInfoId(selectedInfoId)
  }, [activeInfoId, groups, selectedInfoId])

  /**
   * 选择台账中的具体容器，并将其所属试剂同步到右侧详情。
   * @param materialId 用户选择的稳定 Material 容器身份。
   * @param reagentInfoId 该容器所属试剂信息的稳定身份。
   * @returns 无返回值；只发布身份选择，不修改数量或库位事实。
   */
  const inspectContainer = (
    materialId: MaterialId,
    reagentInfoId: string
  ): void => {
    setActiveInfoId(reagentInfoId)
    onSelectContainer(materialId)
  }

  return (
    <section
      id="reagent-ledger"
      className="reagent-catalog"
      aria-label="试剂台账"
    >
      <header className="reagent-catalog__toolbar">
        <div className="reagent-catalog__toolbar-title">
          <strong>容器台账</strong>
          <small>统一查询试剂、批次、数量与库位</small>
        </div>
        <input
          className="reagent-catalog__search"
          type="search"
          aria-label="搜索试剂台账"
          value={query}
          placeholder="搜索名称、CAS、批次、容器或库位"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" onClick={onRequestCreate}>＋ 新建试剂</button>
      </header>

      <button
        type="button"
        className="reagent-catalog__mobile-detail-link"
        onClick={() => globalThis.document
          ?.getElementById('reagent-info-inspector')
          ?.scrollIntoView({ block: 'start' })}
      >
        查看所选试剂详情
      </button>

      {!readStatus.available ? (
        <ReagentCatalogBoundary
          title="试剂目录不可用"
          detail={readStatus.reason}
        />
      ) : !inventoryStatus.available ? (
        <ReagentCatalogBoundary
          title="容器余量不可用"
          detail={inventoryStatus.reason}
        />
      ) : null}

      <div className="reagent-catalog__workspace reagent-catalog__workspace--unified">
        <ReagentContainerLedger
          groups={groups}
          query={query}
          readStatus={inventoryStatus}
          selectedMaterialIds={selectedMaterialIds}
          onSelectContainer={inspectContainer}
        />
        <ReagentInfoInspector
          info={activeGroup?.reagentInfo ?? null}
          events={historyEvents}
          historyStatus={historyStatus}
          updateStatus={updateStatus}
          onUpdateInfo={onUpdateInfo}
        />
      </div>
    </section>
  )
}

/**
 * 渲染试剂信息结构化详情，并通过同一侧栏切换到编辑态。
 * @param props 当前试剂信息、维护能力与宿主写端口。
 * @returns 只提交结构化试剂信息、不修改系统代码的侧栏检查器。
 */
function ReagentInfoInspector({
  info,
  events,
  historyStatus,
  updateStatus,
  onUpdateInfo
}: {
  info: ReagentInfoProjection | null
  events: readonly ReagentHistoryEvent[]
  historyStatus: CapabilityStatus
  updateStatus: CapabilityStatus
  onUpdateInfo?: (input: ReagentInfoProjection) => Promise<void>
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [activeDetail, setActiveDetail] = useState<'information' | 'history'>(
    'information'
  )
  const [draft, setDraft] = useState<ReagentInfoProjection | null>(info)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(info)
    setEditing(false)
    setError(null)
  }, [info])

  /**
   * 更新侧栏中的一个试剂信息字段。
   * @param key 待更新的结构化字段键。
   * @param value 用户输入的新字段值。
   * @returns 无返回值；只修改本地草稿。
   */
  const updateField = <Key extends keyof ReagentInfoProjection>(
    key: Key,
    value: ReagentInfoProjection[Key]
  ): void => {
    setDraft((current) => current ? { ...current, [key]: value } : current)
    setError(null)
  }

  /**
   * 进入编辑态，或在取消时恢复宿主最后确认的试剂信息。
   * @returns 无返回值；取消不会向试剂信息写端口提交任何草稿。
   */
  const toggleEditing = (): void => {
    if (editing) {
      setDraft(info)
      setError(null)
    }
    setEditing((current) => !current)
  }

  /**
   * 将结构化试剂信息提交给宿主专属写端口。
   * @param event 当前表单提交事件。
   * @returns 写端口完成后结束；能力缺失时不提交任何修改。
   */
  const submitInfo = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!draft || !updateStatus.available || !onUpdateInfo) return
    const customFieldError = validateReagentCustomFields(
      draft.customFields ?? []
    )
    if (customFieldError) {
      setError(customFieldError)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onUpdateInfo({
        ...draft,
        customFields: normalizeReagentCustomFields(draft.customFields ?? [])
      })
      setEditing(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '试剂信息保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (!info || !draft) {
    return (
      <aside id="reagent-info-inspector" className="reagent-info-inspector">
        <ReagentEmptyState title="选择试剂信息" detail="从台账选择一个试剂容器。" />
      </aside>
    )
  }

  return (
    <aside
      id="reagent-info-inspector"
      className="reagent-info-inspector"
      data-editing={editing}
    >
      <header>
        <div><small>试剂信息</small><h4>{info.name}</h4></div>
        <button
          type="button"
          hidden={activeDetail !== 'information'}
          disabled={!updateStatus.available || !onUpdateInfo}
          title={!updateStatus.available ? updateStatus.reason : undefined}
          onClick={toggleEditing}
        >
          {editing ? '取消编辑' : '编辑信息'}
        </button>
      </header>
      <div
        className="reagent-info-inspector__tabs"
        role="tablist"
        aria-label={`${info.name}详情`}
      >
        <button
          type="button"
          role="tab"
          id="reagent-info-tab-information"
          aria-controls="reagent-info-panel-information"
          aria-selected={activeDetail === 'information'}
          onClick={() => setActiveDetail('information')}
        >
          基本信息
        </button>
        <button
          type="button"
          role="tab"
          id="reagent-info-tab-history"
          aria-controls="reagent-info-panel-history"
          aria-selected={activeDetail === 'history'}
          disabled={editing}
          title={editing ? '请先保存或取消当前编辑' : undefined}
          onClick={() => setActiveDetail('history')}
        >
          历史记录
        </button>
      </div>
      {activeDetail === 'information' ? (
        <div
          id="reagent-info-panel-information"
          role="tabpanel"
          aria-labelledby="reagent-info-tab-information"
        >
          {editing ? (
            <ReagentInfoEditForm
              draft={draft}
              updateStatus={updateStatus}
              writable={Boolean(onUpdateInfo)}
              saving={saving}
              error={error}
              onFieldChange={updateField}
              onSubmit={submitInfo}
            />
          ) : <ReagentInfoDetails info={info} />}
        </div>
      ) : (
        <div
          id="reagent-info-panel-history"
          role="tabpanel"
          aria-labelledby="reagent-info-tab-history"
        >
          <ReagentHistoryPanel
            reagentInfo={info}
            events={events}
            readStatus={historyStatus}
          />
        </div>
      )}
    </aside>
  )
}

type ReagentInfoFieldUpdater = <Key extends keyof ReagentInfoProjection>(
  key: Key,
  value: ReagentInfoProjection[Key]
) => void

/**
 * 渲染全部可维护试剂主数据字段的结构化表单。
 * @param props 草稿、维护能力、保存状态与字段/提交回调。
 * @returns 不包含系统代码或库存写入的试剂信息编辑表单。
 */
function ReagentInfoEditForm({
  draft,
  updateStatus,
  writable,
  saving,
  error,
  onFieldChange,
  onSubmit
}: {
  draft: ReagentInfoProjection
  updateStatus: CapabilityStatus
  writable: boolean
  saving: boolean
  error: string | null
  onFieldChange: ReagentInfoFieldUpdater
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
}): React.JSX.Element {
  const customFieldError = validateReagentCustomFields(
    draft.customFields ?? []
  )
  const statusText = error ?? customFieldError ?? (updateStatus.available
    ? '保存只修改试剂信息，不改系统代码。'
    : updateStatus.reason)
  return (
    <form onSubmit={onSubmit}>
      <label><span>试剂名称</span><input value={draft.name} onChange={(event) => onFieldChange('name', event.target.value)} /></label>
      <label><span>物理状态</span><select value={draft.physicalState} onChange={(event) => onFieldChange('physicalState', event.target.value)}><option>液体</option><option>固体</option><option>气体</option><option>混合物</option></select></label>
      <label><span>CAS 号</span><input value={draft.cas ?? ''} onChange={(event) => onFieldChange('cas', event.target.value)} /></label>
      <label><span>分子式</span><input value={draft.molecularFormula ?? ''} onChange={(event) => onFieldChange('molecularFormula', event.target.value)} /></label>
      <label><span>分子量（g/mol）</span><input type="number" min="0" step="0.001" value={draft.molecularWeight ?? ''} onChange={(event) => onFieldChange('molecularWeight', event.target.value ? Number(event.target.value) : undefined)} /></label>
      <label><span>SMILES</span><input value={draft.smiles ?? ''} onChange={(event) => onFieldChange('smiles', event.target.value)} /></label>
      <label><span>InChIKey</span><input value={draft.inchiKey ?? ''} onChange={(event) => onFieldChange('inchiKey', event.target.value)} /></label>
      <label><span>厂家</span><input value={draft.manufacturer ?? ''} onChange={(event) => onFieldChange('manufacturer', event.target.value)} /></label>
      <label><span>目录号</span><input value={draft.catalogNumber ?? ''} onChange={(event) => onFieldChange('catalogNumber', event.target.value)} /></label>
      <label><span>默认存储条件</span><input value={draft.defaultStorageCondition ?? ''} onChange={(event) => onFieldChange('defaultStorageCondition', event.target.value)} /></label>
      <label><span>别名</span><input value={draft.aliases.join('，')} onChange={(event) => onFieldChange('aliases', splitReagentTags(event.target.value))} /></label>
      <label><span>危险标签</span><input value={draft.hazardLabels.join('，')} placeholder="多个标签用逗号分隔" onChange={(event) => onFieldChange('hazardLabels', splitReagentTags(event.target.value))} /></label>
      <label><span>说明</span><textarea value={draft.description ?? ''} onChange={(event) => onFieldChange('description', event.target.value)} /></label>
      <ReagentCustomFieldEditor
        fields={draft.customFields ?? []}
        onChange={(fields) => onFieldChange('customFields', fields)}
      />
      <div className="reagent-info-inspector__save-status" role="status">{statusText}</div>
      <button type="submit" className="is-primary" disabled={!updateStatus.available || !writable || saving || Boolean(customFieldError)}>{saving ? '正在保存…' : '保存试剂信息'}</button>
    </form>
  )
}

/**
 * 渲染试剂信息的结构化只读详情。
 * @param props 当前目录选择的试剂信息投影。
 * @returns 化学标识、商品标识、存储和危险标签详情。
 */
function ReagentInfoDetails({
  info
}: {
  info: ReagentInfoProjection
}): React.JSX.Element {
  return (
    <div className="reagent-info-inspector__details">
      <InfoRow label="物理状态" value={info.physicalState} />
      <InfoRow label="CAS 号" value={info.cas ?? '—'} mono />
      <InfoRow label="分子式" value={info.molecularFormula ?? '—'} mono />
      <InfoRow label="分子量" value={info.molecularWeight ? `${info.molecularWeight} g/mol` : '—'} mono />
      <InfoRow label="SMILES" value={info.smiles ?? '—'} mono />
      <InfoRow label="InChIKey" value={info.inchiKey ?? '—'} mono />
      <InfoRow label="厂家 / 目录号" value={[info.manufacturer, info.catalogNumber].filter(Boolean).join(' / ') || '—'} />
      <InfoRow label="存储条件" value={info.defaultStorageCondition ?? '—'} />
      <InfoRow label="别名" value={info.aliases.join('、') || '—'} />
      <div className="reagent-info-inspector__hazards">
        <span>危险标签</span>
        <div>{info.hazardLabels.length
          ? info.hazardLabels.map((hazard) => <strong key={hazard}>{hazard}</strong>)
          : <small>未标记</small>}</div>
      </div>
      <ReagentCustomFieldDetails fields={info.customFields ?? []} />
      <p>{info.description ?? '暂无试剂说明。'}</p>
    </div>
  )
}

/**
 * 将用户输入的中文或英文逗号分隔文本整理为非空标签集合。
 * @param value 别名或危险标签输入文本。
 * @returns 去除空白和空项后的标签数组。
 */
function splitReagentTags(value: string): string[] {
  return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
}

/**
 * 渲染试剂信息详情中的稳定标签—值对。
 * @param props 字段标签、显示值与是否使用等宽数字样式。
 * @returns 单个只读信息行。
 */
function InfoRow({ label, value, mono = false }: {
  label: string
  value: string
  mono?: boolean
}): React.JSX.Element {
  return <dl><dt>{label}</dt><dd className={mono ? 'is-mono' : undefined}>{value}</dd></dl>
}

/**
 * 渲染试剂目录的空状态及可选恢复操作。
 * @param props 空态标题、原因和可选恢复按钮。
 * @returns 不伪造试剂记录的目录空态。
 */
function ReagentEmptyState({
  title,
  detail,
  action,
  onAction
}: {
  title: string
  detail: string
  action?: string
  onAction?: () => void
}): React.JSX.Element {
  return (
    <div className="reagent-empty" role="status">
      <span aria-hidden="true">⌁</span>
      <strong>{title}</strong>
      <small>{detail}</small>
      {action && onAction ? <button type="button" onClick={onAction}>{action}</button> : null}
    </div>
  )
}

/**
 * 展示试剂目录或数量投影缺失时的失败关闭原因。
 * @param props 能力名称与宿主返回的不可用原因。
 * @returns 不以空集合冒充权威查询结果的状态提示。
 */
function ReagentCatalogBoundary({
  title,
  detail
}: {
  title: string
  detail?: string
}): React.JSX.Element {
  return (
    <div className="reagent-capability-boundary" role="status">
      <span aria-hidden="true">!</span>
      <div>
        <strong>{title}</strong>
        <small>{detail ?? '当前宿主未声明此能力'}</small>
      </div>
    </div>
  )
}
