import { useMemo, useState } from 'react'

import type { CapabilityStatus } from './MaterialCapabilityNotice'
import { materialScopeClassName } from './materialStyles'
import type { MaterialTemplateDetail } from './templateMaterial'
import type {
  MaterialAggregate,
  MaterialId,
  MaterialSite
} from './types'

export interface MaterialPlacementCandidate {
  key: string
  parentId: MaterialId
  parentName: string
  siteId: string
  siteName: string
  siteKind: string
}

export interface MaterialPlacementGuideProps {
  aggregate: MaterialAggregate
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>
  template?: MaterialTemplateDetail
  templateLoadState: 'pending' | 'ready' | 'error'
  attachStatus: CapabilityStatus
  pending: boolean
  onAttach: (parentId: MaterialId, siteId: string) => Promise<void>
  onClose: () => void
}

/**
 * 在空间视图中承接新建实例的库位配置流程。
 * @param props 当前实例、资源模板、物料图、放置能力与操作回调。
 * @returns 只从物料权威投影候选库位、并由用户确认写入的流程卡片。
 */
export function MaterialPlacementGuide({
  aggregate,
  aggregatesById,
  template,
  templateLoadState,
  attachStatus,
  pending,
  onAttach,
  onClose
}: MaterialPlacementGuideProps): React.JSX.Element {
  const candidates = useMemo(
    () => compatibleEmptySites(aggregate, aggregatesById, template),
    [aggregate, aggregatesById, template]
  )
  const [selectedKey, setSelectedKey] = useState('')
  const [operationError, setOperationError] = useState<string | null>(null)
  const selectedCandidate = candidates.find(
    (candidate) => candidate.key === selectedKey
  )
  const currentLocation = materialSiteLocation(aggregate, aggregatesById)
  const compatibleKinds = template?.compatibility.allowedSiteTypes ?? []
  const compatibilityReady = templateLoadState === 'ready' && Boolean(template)

  /**
   * 请求物料权威把当前实例放入用户选择的稳定库位。
   * @returns 权威确认后结束；失败时保留选择并展示原因。
   */
  const confirmPlacement = async (): Promise<void> => {
    if (
      !selectedCandidate ||
      !compatibilityReady ||
      !attachStatus.available ||
      pending
    ) return
    setOperationError(null)
    try {
      await onAttach(selectedCandidate.parentId, selectedCandidate.siteId)
      setSelectedKey('')
    } catch (error) {
      setOperationError(
        error instanceof Error ? error.message : '物料位置保存失败，请稍后重试'
      )
    }
  }

  return (
    <aside
      className={materialScopeClassName('material-placement-guide')}
      aria-label="物料实例位置配置"
    >
      <header>
        <div>
          <small>操作流程 · 存储位置</small>
          <strong>{aggregate.material.name}</strong>
        </div>
        <button type="button" aria-label="关闭位置配置" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="material-placement-guide__current">
        <span aria-hidden="true" />
        <div>
          <small>当前位置</small>
          <strong>{currentLocation}</strong>
        </div>
        <code>{aggregate.material.code || aggregate.material.id}</code>
      </div>

      <ol className="material-placement-guide__steps">
        <li className="is-complete">
          <span>1</span>
          <div>
            <strong>确认物料实例</strong>
            <small>已从创建与参数配置步骤带入</small>
          </div>
        </li>
        <li className={selectedCandidate ? 'is-complete' : undefined}>
          <span>2</span>
          <div>
            <strong>选择兼容库位</strong>
            <small>
              {!compatibilityReady
                ? templateLoadState === 'error'
                  ? '兼容规则读取失败，候选库位保持关闭'
                  : '正在读取资源模板兼容规则…'
                : compatibleKinds.length
                ? `兼容类型：${compatibleKinds.join('、')}`
                : '模板未限制库位类型；提交时仍由服务端校验'}
            </small>
          </div>
        </li>
        <li>
          <span>3</span>
          <div>
            <strong>确认物理放置</strong>
            <small>写入稳定库位占用，不代表库存可用或任务预留</small>
          </div>
        </li>
      </ol>

      <label className="material-placement-guide__target">
        <span>目标库位</span>
        <select
          value={selectedKey}
          disabled={!compatibilityReady || !candidates.length || pending}
          onChange={(event) => setSelectedKey(event.target.value)}
        >
          <option value="">
            {!compatibilityReady
              ? templateLoadState === 'error'
                ? '兼容规则读取失败，无法选择库位'
                : '正在读取兼容规则…'
              : candidates.length
              ? `选择兼容且空闲的库位（${candidates.length}）`
              : '当前没有兼容且空闲的库位'}
          </option>
          {candidates.map((candidate) => (
            <option key={candidate.key} value={candidate.key}>
              {candidate.parentName} / {candidate.siteName} · {candidate.siteKind}
            </option>
          ))}
        </select>
      </label>

      {!compatibilityReady ? (
        <p className="material-placement-guide__notice" role="note">
          {templateLoadState === 'error'
            ? '资源模板兼容规则读取失败，恢复后才能配置稳定库位。'
            : '资源模板兼容规则尚未就绪，候选库位暂不开放。'}
        </p>
      ) : !attachStatus.available ? (
        <p className="material-placement-guide__notice" role="note">
          {attachStatus.reason ?? '当前服务未开放物料库位写入'}
        </p>
      ) : null}
      {operationError ? (
        <p className="material-placement-guide__error" role="alert">
          {operationError}
        </p>
      ) : null}

      <footer>
        <small>服务端会再次校验模板兼容性、库位占用和修订版本。</small>
        <button
          type="button"
          disabled={
            !selectedCandidate ||
            !compatibilityReady ||
            !attachStatus.available ||
            pending
          }
          onClick={() => void confirmPlacement()}
        >
          {pending ? '正在确认…' : '确认放置'}
        </button>
      </footer>
    </aside>
  )
}

/**
 * 从当前物料图筛选可供一个实例选择的兼容空库位。
 * @param aggregate 待放置的物料实例。
 * @param aggregatesById 当前物料权威聚合索引。
 * @param template 实例的资源模板详情。
 * @returns 供界面预选的稳定库位；最终兼容性仍由服务端确认。
 */
export function compatibleEmptySites(
  aggregate: MaterialAggregate,
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>,
  template?: MaterialTemplateDetail
): readonly MaterialPlacementCandidate[] {
  if (!template) return []
  const allowedKinds = new Set(
    template.compatibility.allowedSiteTypes ?? []
  )
  return Object.values(aggregatesById)
    .filter((parent) => parent.material.id !== aggregate.material.id)
    .flatMap((parent) => parent.sites
      .filter(
        (site) =>
          site.capacity > 0 && site.occupiedMaterialIds.length === 0
      )
      .filter((site) => !allowedKinds.size || allowedKinds.has(site.kind ?? 'site'))
      .filter((site) => (
        !site.allowedTemplateIds.length ||
        site.allowedTemplateIds.includes(aggregate.material.sourceTemplateId)
      ))
      .map((site) => placementCandidate(parent, site)))
    .sort((left, right) => (
      left.parentName.localeCompare(right.parentName, 'zh-CN') ||
      left.siteName.localeCompare(right.siteName, 'zh-CN')
    ))
}

/**
 * 将稳定库位与所属物料整理为选择控件所需的候选项。
 * @param parent 拥有该库位的父物料。
 * @param site 待投影的稳定库位。
 * @returns 不包含库存、预留或作业执行占用推断的候选项。
 */
function placementCandidate(
  parent: MaterialAggregate,
  site: MaterialSite
): MaterialPlacementCandidate {
  return {
    key: `${parent.material.id}:${site.id}`,
    parentId: parent.material.id,
    parentName: parent.material.name,
    siteId: site.id,
    siteName: site.name,
    siteKind: site.kind ?? 'site'
  }
}

/**
 * 读取当前实例的稳定库位位置文本。
 * @param aggregate 当前物料实例。
 * @param aggregatesById 当前物料权威聚合索引。
 * @returns 已解析的父物料/库位名称，或非库位放置方式。
 */
function materialSiteLocation(
  aggregate: MaterialAggregate,
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>
): string {
  const placement = aggregate.placement
  if (placement.kind === 'unplaced') return '未放置'
  if (placement.kind === 'world') return '实验室空间坐标'
  const parent = aggregatesById[placement.parentId]
  if (placement.kind === 'parent') {
    return parent ? `挂载于 ${parent.material.name}` : '父物料位置'
  }
  const site = parent?.sites.find((candidate) => candidate.id === placement.siteId)
  return `${parent?.material.name ?? placement.parentId} / ${site?.name ?? placement.siteId}`
}
