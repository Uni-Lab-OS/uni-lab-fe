import { clsx } from 'clsx'
import reagentModalStyles from './ReagentModal.module.scss'
import { Alert, Form, InputNumber, Select } from 'antd'
import { useCallback, useMemo } from 'react'
import type {
  CapacityInput,
  CompoundLookup,
  MaterialSummary,
  Reagent,
  ReagentInfo,
  ReagentInfoBatchResult,
} from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import type { ServerCapability } from '@unilab-fe/core'
import { toCapacityInput } from './reagentCapacity'

export type ReagentModalState =
  | { readonly type: 'create-info' }
  | { readonly type: 'edit-info'; readonly info: ReagentInfo }
  | { readonly type: 'catalog-detail'; readonly info: ReagentInfo }
  | { readonly type: 'create-inventory'; readonly info?: ReagentInfo }
  | { readonly type: 'edit-inventory'; readonly reagent: Reagent }
  | { readonly type: 'dispense'; readonly reagent: Reagent }
  | { readonly type: 'history'; readonly reagent: Reagent }
  | { readonly type: 'import'; readonly target: 'catalog' | 'inventory' }

export type ReagentListTab = 'inventory' | 'catalog'

export const PHYSICAL_STATE_LABELS = {
  solid: '固体',
  liquid: '液体',
  gas: '气体',
  other: '其他',
} as const

export const PHYSICAL_STATE_OPTIONS = (
  Object.entries(PHYSICAL_STATE_LABELS) as ReadonlyArray<
    [keyof typeof PHYSICAL_STATE_LABELS, string]
  >
).map(([value, label]) => ({ value, label }))

export const HISTORY_EVENT_LABELS: Readonly<Record<string, string>> = {
  add: '增加',
  remove: '删除',
  adjust: '调整',
  dispense_source: '分装出',
  dispense_target: '分装入',
}

/** 台账事件类型保持 OS 原值，展示时换成中文；未知类型仍显示原文。 */
export function historyEventLabel(value: string): string {
  return HISTORY_EVENT_LABELS[value] ?? value
}

/** 列表和详情用同一份中文，不直接展示 OS 的英文枚举。 */
export function physicalStateLabel(value: string | null | undefined): string {
  if (!value) return '未提供'
  return PHYSICAL_STATE_LABELS[value as keyof typeof PHYSICAL_STATE_LABELS] ?? value
}

export const LOOKUP_TITLES: Readonly<Record<CompoundLookup['status'], string>> = {
  ok: '已从 PubChem 带回化学信息',
  registered: '该 CAS 已在本地目录登记',
  not_found: 'PubChem 未收录该 CAS',
  unavailable: '化合物数据源当前不可用',
}

/** 目录与库存导入返回同形的批量结果，展示层只需要计数与行级错误。 */
export type ImportOutcome = Pick<
  ReagentInfoBatchResult,
  'total' | 'created' | 'failed' | 'atomic' | 'errors'
>

/** 把 OS 的结构化业务错误如实展示，不折叠成一句"操作失败"。 */
export function ErrorAlert({ error }: { error: Error | null }) {
  if (!error) return null
  const details = (error as { details?: Readonly<Record<string, unknown>> }).details
  return (
    <Alert
      className={clsx(reagentModalStyles['reagent-form-field--wide'])}
      type="error"
      showIcon
      message="提交失败"
      description={
        <div>
          <div>{error.message}</div>
          {details && (
            <pre className={clsx(reagentModalStyles['reagent-error-details'])}>
              {JSON.stringify(details, null, 2)}
            </pre>
          )}
        </div>
      }
    />
  )
}

export function useCapabilityGuard() {
  const { backend } = useBackend()
  return useCallback(
    (capability: ServerCapability) => {
      const status = backend.getCapabilityStatus(capability)
      if (!status.available) {
        throw new Error(status.reason ?? '当前端点未开放此项试剂能力')
      }
    },
    [backend],
  )
}

export function ContainerSelect({
  materials,
  disabled,
  value,
  onChange,
}: {
  materials: readonly MaterialSummary[]
  disabled?: boolean
  value?: string
  onChange?: (next: string) => void
}) {
  const options = useMemo(
    () =>
      materials.map((item) => ({
        value: item.materialUuid,
        label: item.barcode ? `${item.name} / ${item.barcode}` : item.name,
      })),
    [materials],
  )
  return (
    <Select
      showSearch
      disabled={disabled}
      value={value}
      onChange={onChange}
      optionFilterProp="label"
      placeholder="按名称或条码搜索容器物料"
      options={options}
      notFoundContent="没有匹配的物料；容器是否为容器模板由 OS 判定"
    />
  )
}

export function FormSection({ title }: { title: string }) {
  return (
    <div
      className={clsx(
        reagentModalStyles['reagent-form-section'],
        reagentModalStyles['reagent-form-field--wide'],
      )}
    >
      {title}
    </div>
  )
}

export const QUANTITY_UNITS = ['uL', 'mL', 'L', 'mg', 'g', 'kg'] as const
export const CONCENTRATION_UNITS = ['%', 'mol/L', 'mmol/L', 'mg/mL', 'g/L'] as const

/** 数值和单位共用一条边框，单位用下拉而不是再挤一个输入框。 */
export function AmountField({
  label,
  valueName,
  unitName,
  required,
  unitOptions,
}: {
  label: string
  valueName: string
  unitName: string
  required?: boolean
  unitOptions: readonly string[]
}) {
  return (
    <Form.Item label={label} required={required}>
      <div className={clsx(reagentModalStyles['reagent-amount-field'])}>
        <Form.Item
          name={valueName}
          noStyle
          rules={required ? [{ required: true, message: `请输入${label}` }] : []}
        >
          <InputNumber
            className={clsx(reagentModalStyles['reagent-amount-value'])}
            min={0}
            controls={false}
          />
        </Form.Item>
        <Form.Item
          name={unitName}
          noStyle
          rules={required ? [{ required: true, message: `请选择${label}单位` }] : []}
        >
          <Select
            className={clsx(reagentModalStyles['reagent-amount-unit'])}
            allowClear={!required}
            popupMatchSelectWidth={false}
            placeholder="单位"
            options={unitOptions.map((unit) => ({ value: unit, label: unit }))}
          />
        </Form.Item>
      </div>
    </Form.Item>
  )
}

/** 表单上限留空表示不改动 OS 已有配置，因此返回 undefined 而不是 0。 */
export function readCapacity(values: Record<string, unknown>): CapacityInput | undefined {
  if (values.capacityValue == null || values.capacityValue === '') return undefined
  return toCapacityInput(Number(values.capacityValue), String(values.capacityUnit ?? 'mL'))
}

/** antd 的 DatePicker 交回 dayjs 实例；这里只需要它的 ISO 序列化能力。 */
interface IsoInstant {
  toISOString(): string
}

export function readObservedAt(value: unknown): string | undefined {
  if (value == null) return undefined
  return (value as IsoInstant).toISOString()
}

export function text(value: unknown): string | undefined {
  const trimmed = String(value ?? '').trim()
  return trimmed === '' ? undefined : trimmed
}

/** 判断化合物库给回的名称是否已经是中文，决定它该落在"名称"还是"英文名"。 */
export function isChineseName(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value)
}
