import { useState, type FormEvent } from 'react'

import type { MaterialMeasurementUnit } from '@unilab/material'

import {
  normalizeReagentCustomFields,
  ReagentCustomFieldEditor,
  validateReagentCustomFields
} from './ReagentCustomFields'
import type { CapabilityStatus } from './reagentWorkspace'
import type {
  NewReagentWorkspaceInput,
  ReagentCustomField
} from './reagentWorkspace'

interface ReagentCreateDraft {
  name: string
  aliases: string
  physicalState: string
  cas: string
  molecularFormula: string
  molecularWeight: string
  manufacturer: string
  catalogNumber: string
  storageCondition: string
  hazardLabels: readonly string[]
  customFields: readonly ReagentCustomField[]
  lotCode: string
  supplierLot: string
  receivedAt: string
  expiresAt: string
  containerName: string
  containerCode: string
  quantity: string
  quantityUnit: MaterialMeasurementUnit
  concentration: string
  concentrationUnit: MaterialMeasurementUnit
}

const INITIAL_DRAFT: ReagentCreateDraft = {
  name: '',
  aliases: '',
  physicalState: '液体',
  cas: '',
  molecularFormula: '',
  molecularWeight: '',
  manufacturer: '',
  catalogNumber: '',
  storageCondition: '2–8 °C 冷藏',
  hazardLabels: [],
  customFields: [],
  lotCode: '',
  supplierLot: '',
  receivedAt: '',
  expiresAt: '',
  containerName: '',
  containerCode: '',
  quantity: '',
  quantityUnit: 'mL',
  concentration: '',
  concentrationUnit: 'mmol/L'
}

const HAZARD_OPTIONS = ['腐蚀性', '易燃', '氧化性', '急性毒性'] as const

export interface ReagentCreateViewProps {
  createStatus: CapabilityStatus
  onCancel: () => void
  onCreate?: (input: NewReagentWorkspaceInput) => Promise<void>
}

/**
 * 以一次明确任务登记试剂信息、批次与首个容器实例。
 * @param props 创建能力、取消回调与专属试剂创建端口。
 * @returns 结构化试剂创建页面；写端口缺失时失败关闭提交。
 */
export function ReagentCreateView({
  createStatus,
  onCancel,
  onCreate
}: ReagentCreateViewProps): React.JSX.Element {
  const [draft, setDraft] = useState<ReagentCreateDraft>(INITIAL_DRAFT)
  const [submitState, setSubmitState] = useState<
    'idle' | 'submitting' | 'failed'
  >('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const customFieldError = validateReagentCustomFields(draft.customFields)
  const valid = Boolean(
    draft.name.trim() &&
    draft.lotCode.trim() &&
    draft.containerName.trim() &&
    draft.containerCode.trim() &&
    Number(draft.quantity) > 0 &&
    !customFieldError
  )

  /**
   * 更新一个结构化试剂草稿字段并清除上一次提交错误。
   * @param key 待更新的结构化草稿字段。
   * @param value 用户输入的新字段值。
   * @returns 无返回值；只修改本地草稿。
   */
  const updateDraft = <Key extends keyof ReagentCreateDraft>(
    key: Key,
    value: ReagentCreateDraft[Key]
  ): void => {
    setDraft((current) => ({ ...current, [key]: value }))
    setSubmitError(null)
    setSubmitState('idle')
  }

  /**
   * 在多选危险标签集合中切换一个标准标签。
   * @param hazard 用户选择的危险标签。
   * @returns 无返回值；标签只进入待提交草稿，不替代正式 SDS。
   */
  const toggleHazard = (hazard: string): void => {
    const selected = draft.hazardLabels.includes(hazard)
    updateDraft(
      'hazardLabels',
      selected
        ? draft.hazardLabels.filter((item) => item !== hazard)
        : [...draft.hazardLabels, hazard]
    )
  }

  /**
   * 将表单草稿转换为专属试剂创建命令并提交到宿主写端口。
   * @param event 当前创建表单提交事件。
   * @returns 写端口完成后结束；能力缺失或校验失败时不创建任何记录。
   */
  const submitDraft = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!valid || !createStatus.available || !onCreate) return
    setSubmitState('submitting')
    setSubmitError(null)
    try {
      await onCreate(buildReagentCreateInput(draft))
      setSubmitState('idle')
      onCancel()
    } catch (error) {
      setSubmitState('failed')
      setSubmitError(error instanceof Error ? error.message : '试剂创建失败')
    }
  }

  return (
    <section
      id="reagent-create-page"
      className="reagent-create"
      aria-labelledby="reagent-create-title"
    >
      <header className="reagent-task-header">
        <div>
          <nav aria-label="试剂创建路径">
            <button type="button" onClick={onCancel}>试剂台账</button>
            <span aria-hidden="true">›</span>
            <span>新建试剂</span>
          </nav>
          <h4 id="reagent-create-title">登记试剂并创建首个容器</h4>
          <p>一次提交建立试剂信息、到货批次和具体瓶/管身份；当前位置可在创建后选择稳定库位。</p>
        </div>
        <span className="reagent-task-header__boundary">
          {createStatus.available ? '写入服务已连接' : '目标设计 · 提交关闭'}
        </span>
      </header>

      <form onSubmit={submitDraft}>
        <div className="reagent-create__form">
          <section>
            <header>
              <span>1</span>
              <div>
                <h5>试剂信息</h5>
                <p>描述可跨多个批次复用的化学或商品身份。</p>
              </div>
            </header>
            <div className="reagent-field-grid">
              <label className="is-wide">
                <span>试剂名称 <em>必填</em></span>
                <input
                  value={draft.name}
                  placeholder="例如：磷酸盐缓冲液（PBS）"
                  onChange={(event) => updateDraft('name', event.target.value)}
                />
              </label>
              <label>
                <span>物理状态</span>
                <select
                  value={draft.physicalState}
                  onChange={(event) => updateDraft(
                    'physicalState',
                    event.target.value
                  )}
                >
                  <option>液体</option>
                  <option>固体</option>
                  <option>气体</option>
                  <option>混合物</option>
                </select>
              </label>
              <label>
                <span>CAS 号</span>
                <input
                  value={draft.cas}
                  placeholder="可选"
                  onChange={(event) => updateDraft('cas', event.target.value)}
                />
              </label>
              <label>
                <span>分子式</span>
                <input
                  value={draft.molecularFormula}
                  placeholder="例如：NaCl"
                  onChange={(event) => updateDraft(
                    'molecularFormula',
                    event.target.value
                  )}
                />
              </label>
              <label>
                <span>分子量</span>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={draft.molecularWeight}
                  placeholder="g/mol"
                  onChange={(event) => updateDraft(
                    'molecularWeight',
                    event.target.value
                  )}
                />
              </label>
              <label>
                <span>厂家</span>
                <input
                  value={draft.manufacturer}
                  onChange={(event) => updateDraft(
                    'manufacturer',
                    event.target.value
                  )}
                />
              </label>
              <label>
                <span>目录号</span>
                <input
                  value={draft.catalogNumber}
                  onChange={(event) => updateDraft(
                    'catalogNumber',
                    event.target.value
                  )}
                />
              </label>
              <label className="is-wide">
                <span>别名</span>
                <input
                  value={draft.aliases}
                  placeholder="多个别名用逗号分隔"
                  onChange={(event) => updateDraft('aliases', event.target.value)}
                />
              </label>
            </div>
            <fieldset className="reagent-hazards">
              <legend>危险标签</legend>
              {HAZARD_OPTIONS.map((hazard) => (
                <label key={hazard}>
                  <input
                    type="checkbox"
                    checked={draft.hazardLabels.includes(hazard)}
                    onChange={() => toggleHazard(hazard)}
                  />
                  <span>{hazard}</span>
                </label>
              ))}
            </fieldset>
            <ReagentCustomFieldEditor
              fields={draft.customFields}
              onChange={(fields) => updateDraft('customFields', fields)}
            />
          </section>

          <section>
            <header>
              <span>2</span>
              <div>
                <h5>批次与容器</h5>
                <p>批次用于质检和有效期追溯，容器是工作流可绑定的具体 Material。</p>
              </div>
            </header>
            <div className="reagent-field-grid">
              <label>
                <span>内部批次号 <em>必填</em></span>
                <input
                  value={draft.lotCode}
                  placeholder="LOT-20260809-01"
                  onChange={(event) => updateDraft('lotCode', event.target.value)}
                />
              </label>
              <label>
                <span>厂家批号</span>
                <input
                  value={draft.supplierLot}
                  onChange={(event) => updateDraft(
                    'supplierLot',
                    event.target.value
                  )}
                />
              </label>
              <label>
                <span>接收日期</span>
                <input
                  type="date"
                  value={draft.receivedAt}
                  onChange={(event) => updateDraft(
                    'receivedAt',
                    event.target.value
                  )}
                />
              </label>
              <label>
                <span>有效期</span>
                <input
                  type="date"
                  value={draft.expiresAt}
                  onChange={(event) => updateDraft(
                    'expiresAt',
                    event.target.value
                  )}
                />
              </label>
              <label>
                <span>容器名称 <em>必填</em></span>
                <input
                  value={draft.containerName}
                  placeholder="PBS 500 mL #01"
                  onChange={(event) => updateDraft(
                    'containerName',
                    event.target.value
                  )}
                />
              </label>
              <label>
                <span>容器编码 <em>必填</em></span>
                <input
                  value={draft.containerCode}
                  placeholder="REAG-PBS-001"
                  onChange={(event) => updateDraft(
                    'containerCode',
                    event.target.value
                  )}
                />
              </label>
              <QuantityField
                label="初始数量"
                value={draft.quantity}
                unit={draft.quantityUnit}
                required
                onValueChange={(value) => updateDraft('quantity', value)}
                onUnitChange={(unit) => updateDraft('quantityUnit', unit)}
              />
              <QuantityField
                label="浓度"
                value={draft.concentration}
                unit={draft.concentrationUnit}
                onValueChange={(value) => updateDraft('concentration', value)}
                onUnitChange={(unit) => updateDraft('concentrationUnit', unit)}
              />
              <label className="is-wide">
                <span>默认存储条件</span>
                <select
                  value={draft.storageCondition}
                  onChange={(event) => updateDraft(
                    'storageCondition',
                    event.target.value
                  )}
                >
                  <option>2–8 °C 冷藏</option>
                  <option>15–25 °C 室温避光</option>
                  <option>−20 °C 冷冻</option>
                  <option>−80 °C 超低温</option>
                </select>
              </label>
            </div>
          </section>
        </div>

        <aside className="reagent-create__summary">
          <h5>创建结果</h5>
          <ol>
            <li><span>1</span><div><strong>试剂信息</strong><small>可复用身份与安全属性</small></div></li>
            <li><span>2</span><div><strong>批次</strong><small>到货、质检与有效期范围</small></div></li>
            <li><span>3</span><div><strong>容器实例</strong><small>稳定 UUID、数量库存与编码</small></div></li>
            <li><span>4</span><div><strong>后续设置库位</strong><small>通过 Site 附着确认当前位置</small></div></li>
          </ol>
          <div className="reagent-boundary-note">
            <strong>不会自动发生</strong>
            <p>创建不代表已放置、可分配、已预留或已被作业占用。</p>
          </div>
        </aside>

        <footer>
          <div role="status">
            {submitError ?? customFieldError ?? (!createStatus.available
              ? createStatus.reason
              : '必填信息完整后可创建试剂、批次与首个容器。')}
          </div>
          <button type="button" onClick={onCancel}>取消</button>
          <button
            type="submit"
            className="is-primary"
            disabled={
              !valid || !createStatus.available || !onCreate ||
              submitState === 'submitting'
            }
          >
            {submitState === 'submitting'
              ? '正在创建…'
              : '创建并返回试剂台账'}
          </button>
        </footer>
      </form>
    </section>
  )
}

/**
 * 渲染带标准单位选择的数量输入字段。
 * @param props 字段名称、数值、标准单位、必填状态与草稿回调。
 * @returns 不执行单位换算的结构化数量输入控件。
 */
function QuantityField({
  label,
  value,
  unit,
  required = false,
  onValueChange,
  onUnitChange
}: {
  label: string
  value: string
  unit: MaterialMeasurementUnit
  required?: boolean
  onValueChange: (value: string) => void
  onUnitChange: (unit: MaterialMeasurementUnit) => void
}): React.JSX.Element {
  return (
    <label>
      <span>{label} {required ? <em>必填</em> : null}</span>
      <span className="reagent-quantity-field">
        <input
          type="number"
          min="0"
          step="0.001"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
        />
        <select
          value={unit}
          aria-label={`${label}单位`}
          onChange={(event) => onUnitChange(
            event.target.value as MaterialMeasurementUnit
          )}
        >
          {(label === '浓度'
            ? ['umol/L', 'mmol/L', 'mol/L', 'mg/mL', 'g/L', '%']
            : ['uL', 'mL', 'L', 'ug', 'mg', 'g']
          ).map((option) => <option key={option}>{option}</option>)}
        </select>
      </span>
    </label>
  )
}

/**
 * 将用户表单值收敛为试剂专属写端口使用的结构化输入。
 * @param draft 已通过页面必填校验的试剂创建草稿。
 * @returns 不包含库位、预留或执行占用承诺的结构化创建输入。
 */
function buildReagentCreateInput(
  draft: ReagentCreateDraft
): NewReagentWorkspaceInput {
  return {
    reagentInfo: {
      name: draft.name.trim(),
      physicalState: draft.physicalState,
      ...(draft.cas.trim() ? { cas: draft.cas.trim() } : {}),
      aliases: draft.aliases.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
      ...(draft.molecularFormula.trim()
        ? { molecularFormula: draft.molecularFormula.trim() }
        : {}),
      ...(Number(draft.molecularWeight) > 0
        ? { molecularWeight: Number(draft.molecularWeight) }
        : {}),
      ...(draft.manufacturer.trim()
        ? { manufacturer: draft.manufacturer.trim() }
        : {}),
      ...(draft.catalogNumber.trim()
        ? { catalogNumber: draft.catalogNumber.trim() }
        : {}),
      defaultStorageCondition: draft.storageCondition,
      hazardLabels: draft.hazardLabels,
      customFields: normalizeReagentCustomFields(draft.customFields)
    },
    lot: {
      code: draft.lotCode.trim(),
      ...(draft.supplierLot.trim()
        ? { supplierLot: draft.supplierLot.trim() }
        : {}),
      ...(draft.receivedAt ? { receivedAt: draft.receivedAt } : {}),
      ...(draft.expiresAt ? { expiresAt: draft.expiresAt } : {})
    },
    container: {
      name: draft.containerName.trim(),
      code: draft.containerCode.trim(),
      quantity: { value: Number(draft.quantity), unit: draft.quantityUnit },
      ...(Number(draft.concentration) > 0
        ? {
            concentration: {
              value: Number(draft.concentration),
              unit: draft.concentrationUnit
            }
          }
        : {}),
      storageCondition: draft.storageCondition
    }
  }
}
