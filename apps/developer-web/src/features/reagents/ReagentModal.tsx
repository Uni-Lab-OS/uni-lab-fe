import { cx } from '../../styles/styleMaps'
import {
  Alert,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Pagination,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  Upload,
} from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CapacityInput,
  CompoundLookup,
  MaterialSummary,
  Reagent,
  ReagentDispenseResult,
  ReagentHistoryPage,
  ReagentInfo,
  ReagentInfoBatchResult,
  ReagentStructure3d,
} from '@unilab-fe/core'
import { DefinitionList } from '@unilab/lab-ui'
import { useBackend } from '../../app/BackendProvider'
import type { ServerCapability } from '@unilab-fe/core'
import {
  CAPACITY_UNIT_OPTIONS,
  defaultCapacityUnit,
  formatCapacity,
  toCapacityInput,
} from './reagentCapacity'

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

const PHYSICAL_STATE_LABELS = {
  solid: '固体',
  liquid: '液体',
  gas: '气体',
  other: '其他',
} as const

const PHYSICAL_STATE_OPTIONS = (
  Object.entries(PHYSICAL_STATE_LABELS) as ReadonlyArray<
    [keyof typeof PHYSICAL_STATE_LABELS, string]
  >
).map(([value, label]) => ({ value, label }))

const HISTORY_EVENT_LABELS: Readonly<Record<string, string>> = {
  add: '增加',
  remove: '删除',
  adjust: '调整',
  dispense_source: '分装出',
  dispense_target: '分装入',
}

/** 台账事件类型保持 OS 原值，展示时换成中文；未知类型仍显示原文。 */
function historyEventLabel(value: string): string {
  return HISTORY_EVENT_LABELS[value] ?? value
}

/** 列表和详情用同一份中文，不直接展示 OS 的英文枚举。 */
export function physicalStateLabel(value: string | null | undefined): string {
  if (!value) return '未提供'
  return PHYSICAL_STATE_LABELS[value as keyof typeof PHYSICAL_STATE_LABELS] ?? value
}

const LOOKUP_TITLES: Readonly<Record<CompoundLookup['status'], string>> = {
  ok: '已从 PubChem 带回化学信息',
  registered: '该 CAS 已在本地目录登记',
  not_found: 'PubChem 未收录该 CAS',
  unavailable: '化合物数据源当前不可用',
}

/** 目录与库存导入返回同形的批量结果，展示层只需要计数与行级错误。 */
type ImportOutcome = Pick<
  ReagentInfoBatchResult,
  'total' | 'created' | 'failed' | 'atomic' | 'errors'
>

export function ReagentModal({
  state,
  materials,
  catalog,
  onClose,
  onSaved,
}: {
  state: ReagentModalState | null
  materials: readonly MaterialSummary[]
  catalog: readonly ReagentInfo[]
  onClose: () => void
  onSaved: (tab: ReagentListTab) => void
}) {
  if (!state) return null
  switch (state.type) {
    case 'catalog-detail':
      return <CatalogDetail info={state.info} onClose={onClose} />
    case 'history':
      return <HistoryModal reagent={state.reagent} onClose={onClose} />
    case 'create-info':
    case 'edit-info':
      return <InfoFormModal state={state} onClose={onClose} onSaved={() => onSaved('catalog')} />
    case 'dispense':
      return (
        <DispenseModal
          reagent={state.reagent}
          materials={materials}
          onClose={onClose}
          onSaved={() => onSaved('inventory')}
        />
      )
    case 'import':
      return (
        <ImportModal
          target={state.target}
          onClose={onClose}
          onSaved={() => onSaved(state.target)}
        />
      )
    default:
      return (
        <InventoryFormModal
          state={state}
          materials={materials}
          catalog={catalog}
          onClose={onClose}
          onSaved={() => onSaved('inventory')}
        />
      )
  }
}

/** 把 OS 的结构化业务错误如实展示，不折叠成一句"操作失败"。 */
function ErrorAlert({ error }: { error: Error | null }) {
  if (!error) return null
  const details = (error as { details?: Readonly<Record<string, unknown>> }).details
  return (
    <Alert
      className={cx('form-error reagent-form-field--wide')}
      type="error"
      showIcon
      message="提交失败"
      description={
        <div>
          <div>{error.message}</div>
          {details && (
            <pre className={cx('reagent-error-details')}>{JSON.stringify(details, null, 2)}</pre>
          )}
        </div>
      }
    />
  )
}

function useCapabilityGuard() {
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

function ContainerSelect({
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

function FormSection({ title }: { title: string }) {
  return <div className={cx('reagent-form-section reagent-form-field--wide')}>{title}</div>
}

const QUANTITY_UNITS = ['uL', 'mL', 'L', 'mg', 'g', 'kg'] as const
const CONCENTRATION_UNITS = ['%', 'mol/L', 'mmol/L', 'mg/mL', 'g/L'] as const

/** 数值和单位共用一条边框，单位用下拉而不是再挤一个输入框。 */
function AmountField({
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
      <div className={cx('reagent-amount-field')}>
        <Form.Item
          name={valueName}
          noStyle
          rules={required ? [{ required: true, message: `请输入${label}` }] : []}
        >
          <InputNumber className={cx('reagent-amount-value')} min={0} controls={false} />
        </Form.Item>
        <Form.Item
          name={unitName}
          noStyle
          rules={required ? [{ required: true, message: `请选择${label}单位` }] : []}
        >
          <Select
            className={cx('reagent-amount-unit')}
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
function readCapacity(values: Record<string, unknown>): CapacityInput | undefined {
  if (values.capacityValue == null || values.capacityValue === '') return undefined
  return toCapacityInput(Number(values.capacityValue), String(values.capacityUnit ?? 'mL'))
}

/** antd 的 DatePicker 交回 dayjs 实例；这里只需要它的 ISO 序列化能力。 */
interface IsoInstant {
  toISOString(): string
}

function readObservedAt(value: unknown): string | undefined {
  if (value == null) return undefined
  return (value as IsoInstant).toISOString()
}

function text(value: unknown): string | undefined {
  const trimmed = String(value ?? '').trim()
  return trimmed === '' ? undefined : trimmed
}

/** 判断化合物库给回的名称是否已经是中文，决定它该落在"名称"还是"英文名"。 */
function isChineseName(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value)
}

function CatalogDetail({ info, onClose }: { info: ReagentInfo; onClose: () => void }) {
  const { backend } = useBackend()
  const canReadStructure = backend.getCapabilityStatus('reagentInfo.readStructure3d')
  const [structure, setStructure] = useState<ReagentStructure3d | null>(null)
  const [structureError, setStructureError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(canReadStructure.available)

  useEffect(() => {
    if (!canReadStructure.available) return
    let active = true
    setLoading(true)
    void backend.core.reagentInventory
      .getReagentInfoStructure3d(info.reagentInfoUuid)
      .then((value) => {
        if (active) setStructure(value)
      })
      .catch((cause: unknown) => {
        if (active)
          setStructureError(cause instanceof Error ? cause : new Error('读取三维结构失败'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [backend, canReadStructure.available, info.reagentInfoUuid])

  return (
    <Modal
      open
      className={cx('reagent-detail-modal')}
      width={640}
      title="试剂目录详情"
      footer={<Button onClick={onClose}>关闭</Button>}
      onCancel={onClose}
    >
      <div className={cx('reagent-detail-content')}>
        <section className={cx('reagent-detail-section')} aria-labelledby="reagent-detail-identity">
          <h3 id="reagent-detail-identity">基础信息</h3>
          <DefinitionList
            variant="form"
            columns={2}
            className={cx('reagent-detail-grid')}
            items={[
              { label: '名称', value: info.name },
              { label: '英文名', value: info.nameEn },
              {
                label: '别名',
                value: info.aliases.length ? info.aliases.join('、') : null,
                wide: true,
              },
            ]}
          />
        </section>

        <section
          className={cx('reagent-detail-section')}
          aria-labelledby="reagent-detail-properties"
        >
          <h3 id="reagent-detail-properties">化学属性</h3>
          <DefinitionList
            variant="form"
            columns={2}
            className={cx('reagent-detail-grid')}
            items={[
              { label: 'CAS 号', value: info.cas, mono: true },
              { label: '分子式', value: info.molecularFormula, mono: true },
              { label: '物态', value: physicalStateLabel(info.physicalState) },
              {
                label: '分子量',
                value: info.molecularWeight == null ? null : `${info.molecularWeight} g/mol`,
              },
              {
                label: '密度',
                value: info.densityGPerMl == null ? null : `${info.densityGPerMl} g/mL`,
              },
            ]}
          />
        </section>

        <section
          className={cx('reagent-detail-section')}
          aria-labelledby="reagent-detail-identifiers"
        >
          <h3 id="reagent-detail-identifiers">结构标识</h3>
          <DefinitionList
            variant="form"
            columns={2}
            className={cx('reagent-detail-grid')}
            items={[
              { label: 'SMILES', value: info.smiles, mono: true, wide: true },
              { label: 'InChIKey', value: info.inchiKey, mono: true, wide: true },
            ]}
          />
        </section>

        <section className={cx('reagent-detail-section')} aria-labelledby="reagent-detail-notes">
          <h3 id="reagent-detail-notes">备注</h3>
          <DefinitionList
            variant="form"
            columns={2}
            className={cx('reagent-detail-grid')}
            items={[{ label: '描述', value: info.description, wide: true }]}
          />
        </section>

        <section
          className={cx('reagent-detail-section')}
          aria-labelledby="reagent-detail-structure"
        >
          <h3 id="reagent-detail-structure">三维结构</h3>
          <div className={cx('reagent-detail-grid')}>
            {!canReadStructure.available ? (
              <div className={cx('reagent-detail-empty', 'reagent-detail-field--wide')}>
                {canReadStructure.reason ?? '当前端点未开放三维结构读取能力'}
              </div>
            ) : loading ? (
              <div className={cx('reagent-detail-empty', 'reagent-detail-field--wide')}>
                正在读取结构缓存...
              </div>
            ) : structureError ? (
              <Alert
                className={cx('reagent-detail-field--wide')}
                type="error"
                showIcon
                message="三维结构读取失败"
                description={structureError.message}
              />
            ) : structure?.content ? (
              <DefinitionList
                variant="form"
                columns={2}
                className={cx('reagent-detail-grid')}
                items={[
                  { label: '状态', value: <Tag color="success">{structure.status}</Tag> },
                  { label: '格式', value: structure.format },
                  {
                    label: '来源',
                    value: `${structure.structureSource ?? ''}${structure.sourceId ? ` / ${structure.sourceId}` : ''}`,
                  },
                  { label: '生成时间', value: structure.generatedAt },
                  { label: '结构内容', value: `已缓存 ${structure.content.length} 字符` },
                ]}
              />
            ) : (
              <div className={cx('reagent-detail-empty', 'reagent-detail-field--wide')}>
                <Tag color="warning">待生成</Tag>
                <span>{structure?.errorMessage ?? '尚未生成'}</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </Modal>
  )
}

function HistoryModal({ reagent, onClose }: { reagent: Reagent; onClose: () => void }) {
  const { backend } = useBackend()
  const status = backend.getCapabilityStatus('inventory.readReagentHistory')
  const [page, setPage] = useState(1)
  const [history, setHistory] = useState<ReagentHistoryPage | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(status.available)
  const pageSize = 10

  useEffect(() => {
    if (!status.available) {
      setError(new Error(status.reason ?? '当前端点未开放库存历史读取能力'))
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    void backend.core.reagentInventory
      .listReagentHistory(reagent.materialUuid, { page, pageSize })
      .then((value) => {
        if (active) setHistory(value)
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause : new Error('读取历史失败'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [backend, page, reagent.materialUuid, status.available, status.reason])

  return (
    <Modal
      open
      width={680}
      title={`库存历史 · ${reagent.name}`}
      footer={<Button onClick={onClose}>关闭</Button>}
      onCancel={onClose}
    >
      {loading ? (
        <Typography.Text type="secondary">正在读取不可变库存台账...</Typography.Text>
      ) : error ? (
        <Alert type="error" showIcon message="历史读取失败" description={error.message} />
      ) : history?.items.length ? (
        <>
          <List
            className={cx('history-list')}
            dataSource={[...history.items]}
            renderItem={(item) => (
              <List.Item>
                <div>
                  <strong>{historyEventLabel(item.eventType)}</strong>
                  <span>
                    {item.quantityDelta == null
                      ? '数量未提供'
                      : `${item.quantityDelta > 0 ? '+' : ''}${item.quantityDelta} ${item.quantityUnit ?? ''}`}
                  </span>
                </div>
                <small>
                  {item.recordedAt} / {item.operatorType}
                  {/* 录入时填的来源存在台账扩展里，是追溯这条变更的关键线索。 */}
                  {typeof item.extension.source === 'string' && item.extension.source !== ''
                    ? ` / ${item.extension.source}`
                    : ''}
                  {item.causationId ? ` / 关联 ${item.causationId}` : ''}
                </small>
              </List.Item>
            )}
          />
          <Pagination
            className={cx('reagent-history-pagination')}
            simple
            current={page}
            pageSize={pageSize}
            // OS 只返回 has_more，不返回总数；这里按"当前页+是否还有下一页"推算。
            total={page * pageSize + (history.hasMore ? 1 : 0)}
            onChange={setPage}
          />
        </>
      ) : (
        <Typography.Text type="secondary">暂无库存变更记录</Typography.Text>
      )}
    </Modal>
  )
}

function InfoFormModal({
  state,
  onClose,
  onSaved,
}: {
  state: Extract<ReagentModalState, { type: 'create-info' | 'edit-info' }>
  onClose: () => void
  onSaved: () => void
}) {
  const { backend } = useBackend()
  const guard = useCapabilityGuard()
  const [form] = Form.useForm<Record<string, unknown>>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [lookupError, setLookupError] = useState<Error | null>(null)
  const [lookup, setLookup] = useState<CompoundLookup | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const isCreate = state.type === 'create-info'
  const canLookup = backend.getCapabilityStatus('reagentInfo.lookupCompound')

  const lookupByCas = async () => {
    const cas = text(form.getFieldValue('cas'))
    if (!cas) {
      setLookup(null)
      setLookupError(new Error('请先填写 CAS 号'))
      return
    }
    setLookupLoading(true)
    setLookup(null)
    setLookupError(null)
    setError(null)
    try {
      guard('reagentInfo.lookupCompound')
      const result = await backend.core.reagentInventory.lookupCompound(cas)
      setLookup(result)
      if (result.compound) {
        // 只预填用户还没写过的字段，避免覆盖手工录入的更准确数据。
        const candidate = result.compound
        const patch: Record<string, string | number> = {}
        if (candidate.name) {
          // PubChem 只给英文名，它属于"英文名"而不是"名称"；中文名仍需人工确认，
          // 这里只在名称为空时用英文兜底，避免必填项卡住录入。
          if (isChineseName(candidate.name)) {
            if (!text(form.getFieldValue('name'))) patch.name = candidate.name
          } else {
            if (!text(form.getFieldValue('nameEn'))) patch.nameEn = candidate.name
            if (!text(form.getFieldValue('name'))) patch.name = candidate.name
          }
        }
        if (!text(form.getFieldValue('molecularFormula')) && candidate.molecularFormula)
          patch.molecularFormula = candidate.molecularFormula
        if (!text(form.getFieldValue('smiles')) && candidate.smiles) patch.smiles = candidate.smiles
        if (!text(form.getFieldValue('inchiKey')) && candidate.inchiKey)
          patch.inchiKey = candidate.inchiKey
        if (form.getFieldValue('molecularWeight') == null && candidate.molecularWeight != null)
          patch.molecularWeight = candidate.molecularWeight
        if (form.getFieldValue('densityGPerMl') == null && candidate.densityGPerMl != null)
          patch.densityGPerMl = candidate.densityGPerMl
        form.setFieldsValue(patch)
      }
    } catch (cause) {
      setLookupError(cause instanceof Error ? cause : new Error('CAS 查询失败'))
    } finally {
      setLookupLoading(false)
    }
  }

  const submit = async (values: Record<string, unknown>) => {
    setLoading(true)
    setError(null)
    try {
      const draft = {
        name: String(values.name),
        nameEn: text(values.nameEn) ?? null,
        cas: text(values.cas),
        aliases: text(values.aliases)
          ? String(values.aliases)
              .split(/[,，\s]+/)
              .filter(Boolean)
          : [],
        molecularFormula: text(values.molecularFormula) ?? null,
        smiles: text(values.smiles) ?? null,
        inchiKey: text(values.inchiKey) ?? null,
        molecularWeight: values.molecularWeight == null ? null : Number(values.molecularWeight),
        densityGPerMl: values.densityGPerMl == null ? null : Number(values.densityGPerMl),
        physicalState: String(values.physicalState),
        description: text(values.description) ?? null,
      }
      if (isCreate) {
        guard('reagentInfo.create')
        await backend.core.reagentInventory.createReagentInfo(draft)
      } else {
        guard('reagentInfo.update')
        await backend.core.reagentInventory.updateReagentInfo(state.info.reagentInfoUuid, draft)
      }
      onSaved()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('写入失败'))
    } finally {
      setLoading(false)
    }
  }

  const info = isCreate ? null : state.info
  return (
    <Modal
      open
      className={cx('reagent-mutation-modal')}
      width={720}
      title={isCreate ? '新增试剂目录' : `编辑试剂目录 · ${info?.name}`}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      <Form
        form={form}
        className={cx('reagent-mutation-form')}
        layout="vertical"
        initialValues={{
          name: info?.name,
          nameEn: info?.nameEn ?? undefined,
          cas: info?.cas ?? undefined,
          aliases: info?.aliases.join('、'),
          molecularFormula: info?.molecularFormula ?? undefined,
          smiles: info?.smiles ?? undefined,
          inchiKey: info?.inchiKey ?? undefined,
          molecularWeight: info?.molecularWeight ?? undefined,
          densityGPerMl: info?.densityGPerMl ?? undefined,
          physicalState: info?.physicalState ?? 'liquid',
          description: info?.description ?? undefined,
        }}
        onFinish={submit}
      >
        <div className={cx('reagent-form-grid')}>
          <FormSection title="化学身份" />
          <Form.Item
            className={cx('reagent-form-field--wide')}
            label="CAS 号"
            validateStatus={lookupError ? 'error' : undefined}
            help={lookupError?.message}
          >
            <div className={cx('reagent-cas-lookup')}>
              <Form.Item name="cas" noStyle>
                <Input
                  status={lookupError ? 'error' : undefined}
                  className={cx('reagent-identifier-input')}
                  placeholder="例如 75-05-8"
                  onChange={() => {
                    setLookup(null)
                    if (lookupError) setLookupError(null)
                  }}
                />
              </Form.Item>
              <Button
                className={cx('reagent-lookup-button')}
                loading={lookupLoading}
                disabled={!canLookup.available}
                onClick={() => void lookupByCas()}
              >
                查询并预填
              </Button>
            </div>
          </Form.Item>
          {lookup && (
            <Alert
              className={cx('reagent-form-field--wide reagent-lookup-result')}
              type={
                lookup.status === 'ok'
                  ? 'success'
                  : lookup.status === 'registered'
                    ? 'info'
                    : 'warning'
              }
              showIcon
              message={
                lookup.status === 'ok'
                  ? LOOKUP_TITLES.ok
                  : (lookup.message ?? LOOKUP_TITLES[lookup.status])
              }
            />
          )}
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: '请输入试剂名称' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item label="英文名" name="nameEn">
            <Input />
          </Form.Item>
          <Form.Item className={cx('reagent-form-field--wide')} label="别名" name="aliases">
            <Input placeholder="逗号或空格分隔" />
          </Form.Item>
          <FormSection title="物理性质" />
          <Form.Item
            label="物态"
            name="physicalState"
            rules={[{ required: true, message: '请选择物态' }]}
          >
            <Select options={PHYSICAL_STATE_OPTIONS} />
          </Form.Item>
          <Form.Item label="分子式" name="molecularFormula">
            <Input className={cx('reagent-identifier-input')} placeholder="例如 C2H3N" />
          </Form.Item>
          <Form.Item label="分子量 (g/mol)" name="molecularWeight">
            <InputNumber className={cx('full-input')} min={0} />
          </Form.Item>
          <Form.Item label="密度 (g/mL)" name="densityGPerMl">
            <InputNumber className={cx('full-input')} min={0} />
          </Form.Item>
          <FormSection title="结构标识" />
          <Form.Item label="SMILES" name="smiles">
            <Input className={cx('reagent-identifier-input')} placeholder="例如 CC#N" />
          </Form.Item>
          <Form.Item label="InChIKey" name="inchiKey">
            <Input
              className={cx('reagent-identifier-input')}
              placeholder="例如 WEVYAHXRMPXWCK-UHFFFAOYSA-N"
            />
          </Form.Item>
          <FormSection title="备注" />
          <Form.Item className={cx('reagent-form-field--wide')} label="描述" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
          <ErrorAlert error={error} />
          <div className={cx('modal-actions reagent-form-field--wide')}>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" htmlType="submit" loading={loading}>
              保存
            </Button>
          </div>
        </div>
      </Form>
    </Modal>
  )
}

function InventoryFormModal({
  state,
  materials,
  catalog,
  onClose,
  onSaved,
}: {
  state: Extract<ReagentModalState, { type: 'create-inventory' | 'edit-inventory' }>
  materials: readonly MaterialSummary[]
  catalog: readonly ReagentInfo[]
  onClose: () => void
  onSaved: () => void
}) {
  const { backend } = useBackend()
  const guard = useCapabilityGuard()
  const [form] = Form.useForm<Record<string, unknown>>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const isCreate = state.type === 'create-inventory'
  const reagent = isCreate ? null : state.reagent
  const presetInfo = isCreate ? state.info : null
  const [identityMode, setIdentityMode] = useState<'uuid' | 'cas'>('uuid')

  const submit = async (values: Record<string, unknown>) => {
    setLoading(true)
    setError(null)
    try {
      const capacity = readCapacity(values)
      if (isCreate) {
        guard('inventory.createReagent')
        await backend.core.reagentInventory.createReagent({
          materialUuid: String(values.materialUuid),
          reagentInfoUuid:
            identityMode === 'uuid'
              ? (presetInfo?.reagentInfoUuid ?? text(values.reagentInfoUuid))
              : undefined,
          cas: identityMode === 'cas' ? text(values.cas) : undefined,
          quantity: Number(values.quantity),
          quantityUnit: String(values.quantityUnit),
          physicalState: text(values.physicalState),
          concentrationValue:
            values.concentrationValue == null ? null : Number(values.concentrationValue),
          concentrationUnit: text(values.concentrationUnit) ?? null,
          densityGPerMl: values.densityGPerMl == null ? null : Number(values.densityGPerMl),
          // 这两项描述本次登记动作本身，留空就不发送，不能发 null 当作清空。
          source: text(values.source),
          observedAt: readObservedAt(values.observedAt),
          description: text(values.description) ?? null,
          ...(capacity ? { containerCapacity: capacity } : {}),
        })
      } else {
        guard('inventory.updateReagent')
        await backend.core.reagentInventory.updateReagent(state.reagent.reagentUuid, {
          quantity: Number(values.quantity),
          quantityUnit: String(values.quantityUnit),
          // revision 未知时不能编造期望值，否则会误触发乐观并发拒绝。
          ...(state.reagent.revision == null ? {} : { expectedRevision: state.reagent.revision }),
          concentrationValue:
            values.concentrationValue == null ? null : Number(values.concentrationValue),
          concentrationUnit: text(values.concentrationUnit) ?? null,
          source: text(values.source),
          observedAt: readObservedAt(values.observedAt),
          description: text(values.description) ?? null,
          ...(capacity ? { containerCapacity: capacity } : {}),
          ...(capacity && state.reagent.materialRevision != null
            ? { expectedMaterialRevision: state.reagent.materialRevision }
            : {}),
        })
      }
      onSaved()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('写入失败'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open
      className={cx('reagent-mutation-modal')}
      width={720}
      title={isCreate ? '录入试剂库存' : `编辑试剂库存 · ${reagent?.name}`}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      <Form
        form={form}
        className={cx('reagent-mutation-form')}
        layout="vertical"
        initialValues={{
          materialUuid: reagent?.materialUuid,
          reagentInfoUuid: presetInfo?.reagentInfoUuid,
          quantity: reagent?.quantity ?? undefined,
          quantityUnit: reagent?.quantityUnit ?? 'mL',
          physicalState: presetInfo?.physicalState ?? 'liquid',
          concentrationValue: reagent?.concentrationValue ?? undefined,
          concentrationUnit: reagent?.concentrationUnit ?? undefined,
          densityGPerMl: reagent?.densityGPerMl ?? undefined,
          description: reagent?.description ?? undefined,
          capacityUnit: defaultCapacityUnit(reagent?.quantityUnit ?? null),
        }}
        onFinish={submit}
      >
        <div className={cx('reagent-form-grid')}>
          <FormSection title="容器与身份" />
          <Form.Item
            className={cx('reagent-form-field--wide')}
            label="容器物料"
            name="materialUuid"
            rules={[{ required: true, message: '请选择承载试剂的容器物料' }]}
          >
            <ContainerSelect materials={materials} disabled={!isCreate} />
          </Form.Item>
          {isCreate &&
            (presetInfo ? (
              <Form.Item className={cx('reagent-form-field--wide')} label="试剂身份">
                <Input
                  readOnly
                  value={
                    presetInfo.cas ? `${presetInfo.name} / ${presetInfo.cas}` : presetInfo.name
                  }
                />
              </Form.Item>
            ) : (
              <>
                <Form.Item label="身份来源">
                  <Select
                    value={identityMode}
                    onChange={setIdentityMode}
                    options={[
                      { value: 'uuid', label: '已有目录身份' },
                      { value: 'cas', label: '按 CAS 自动登记' },
                    ]}
                  />
                </Form.Item>
                {identityMode === 'uuid' ? (
                  <Form.Item
                    label="试剂身份"
                    name="reagentInfoUuid"
                    rules={[{ required: true, message: '请选择目录中的试剂' }]}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      placeholder="按名称或 CAS 选择"
                      options={catalog.map((item) => ({
                        value: item.reagentInfoUuid,
                        label: item.cas ? `${item.name} / ${item.cas}` : item.name,
                      }))}
                      notFoundContent="目录里还没有试剂身份"
                    />
                  </Form.Item>
                ) : (
                  <Form.Item
                    label="CAS 号"
                    name="cas"
                    rules={[{ required: true, message: '请输入 CAS 号' }]}
                  >
                    <Input placeholder="例如 64-17-5" />
                  </Form.Item>
                )}
              </>
            ))}
          <FormSection title="数量与物性" />
          <AmountField
            label="库存量"
            valueName="quantity"
            unitName="quantityUnit"
            required
            unitOptions={QUANTITY_UNITS}
          />
          {isCreate && (
            <Form.Item label="物态" name="physicalState">
              <Select allowClear options={PHYSICAL_STATE_OPTIONS} />
            </Form.Item>
          )}
          <AmountField
            label="浓度"
            valueName="concentrationValue"
            unitName="concentrationUnit"
            unitOptions={CONCENTRATION_UNITS}
          />
          {isCreate && (
            <Form.Item label="密度 (g/mL)" name="densityGPerMl">
              <InputNumber className={cx('full-input')} min={0} />
            </Form.Item>
          )}
          <FormSection title="容器装料上限" />
          {reagent && (
            <Alert
              className={cx('reagent-form-field--wide reagent-capacity-note')}
              type="info"
              showIcon
              message={`当前生效上限 ${formatCapacity(reagent.maximumCapacity)}，试剂版本 ${reagent.revision ?? '未提供'}`}
            />
          )}
          <AmountField
            label="装料上限"
            valueName="capacityValue"
            unitName="capacityUnit"
            unitOptions={CAPACITY_UNIT_OPTIONS}
          />
          <FormSection title="记录来源" />
          <Form.Item label="来源" name="source">
            <Input />
          </Form.Item>
          <Form.Item label="观测时间" name="observedAt">
            <DatePicker className={cx('full-input')} showTime placeholder="选择时间" />
          </Form.Item>
          <Form.Item className={cx('reagent-form-field--wide')} label="说明" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
          <ErrorAlert error={error} />
          <div className={cx('modal-actions reagent-form-field--wide')}>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" htmlType="submit" loading={loading}>
              保存
            </Button>
          </div>
        </div>
      </Form>
    </Modal>
  )
}

function DispenseModal({
  reagent,
  materials,
  onClose,
  onSaved,
}: {
  reagent: Reagent
  materials: readonly MaterialSummary[]
  onClose: () => void
  onSaved: () => void
}) {
  const { backend } = useBackend()
  const guard = useCapabilityGuard()
  const [form] = Form.useForm<Record<string, unknown>>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [result, setResult] = useState<ReagentDispenseResult | null>(null)
  // 幂等键在弹窗生命周期内固定，重试同一次分装不会重复扣减。
  const commandId = useRef(crypto.randomUUID())

  const submit = async (values: Record<string, unknown>) => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      guard('inventory.dispenseReagent')
      const rows = (values.targets as readonly Record<string, unknown>[]) ?? []
      const capacity = readCapacity(values)
      const outcome = await backend.core.reagentInventory.dispenseReagent({
        commandId: commandId.current,
        sourceReagentUuid: reagent.reagentUuid,
        quantityUnit: String(values.quantityUnit),
        ...(reagent.revision == null ? {} : { expectedRevision: reagent.revision }),
        reason: text(values.reason),
        targets: rows.map((row) => ({
          materialUuid: String(row.materialUuid),
          quantity: Number(row.quantity),
          ...(capacity ? { containerCapacity: capacity } : {}),
        })),
      })
      setResult(outcome)
      onSaved()
      // OS 明确报出错误码时保留弹窗，让用户看到失败原因而不是静默关闭。
      if (!outcome.errorCode) onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('分装失败'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open
      className={cx('reagent-mutation-modal')}
      width={720}
      title={`试剂分装 · ${reagent.name}`}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      <Alert
        className={cx('reagent-dispense-source')}
        type="info"
        showIcon
        message={`源瓶余量 ${reagent.quantity ?? '未提供'} ${reagent.quantityUnit ?? ''}`}
      />
      <Form
        form={form}
        className={cx('reagent-mutation-form')}
        layout="vertical"
        initialValues={{
          quantityUnit: reagent.quantityUnit ?? 'mL',
          targets: [{}],
          capacityUnit: defaultCapacityUnit(reagent.quantityUnit),
        }}
        onFinish={submit}
      >
        <div className={cx('reagent-form-grid')}>
          <FormSection title="分装" />
          <Form.Item
            label="分装单位"
            name="quantityUnit"
            rules={[{ required: true, message: '请选择分装单位' }]}
          >
            <Select
              options={QUANTITY_UNITS.map((unit) => ({
                value: unit,
                label: unit,
              }))}
            />
          </Form.Item>
          <Form.Item label="原因" name="reason">
            <Input />
          </Form.Item>
          <FormSection title="目标容器" />
          <AmountField
            label="装料上限"
            valueName="capacityValue"
            unitName="capacityUnit"
            unitOptions={CAPACITY_UNIT_OPTIONS}
          />
          <Form.List name="targets">
            {(fields, { add, remove }) => (
              <div className={cx('reagent-form-field--wide reagent-dispense-targets')}>
                {fields.map((field, index) => (
                  <div className={cx('reagent-dispense-target')} key={field.key}>
                    <Form.Item
                      name={[field.name, 'materialUuid']}
                      label={index === 0 ? '目标容器' : undefined}
                      rules={[{ required: true, message: '请选择目标容器' }]}
                    >
                      <ContainerSelect
                        materials={materials.filter(
                          (item) => item.materialUuid !== reagent.materialUuid,
                        )}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'quantity']}
                      label={index === 0 ? '分装量' : undefined}
                      rules={[{ required: true, message: '请输入分装量' }]}
                    >
                      <InputNumber className={cx('full-input')} min={0} controls={false} />
                    </Form.Item>
                    <Button
                      type="text"
                      danger
                      disabled={fields.length === 1}
                      onClick={() => remove(field.name)}
                    >
                      移除
                    </Button>
                  </div>
                ))}
                <Button onClick={() => add({})}>新增目标容器</Button>
              </div>
            )}
          </Form.List>
          {result && (
            <Alert
              className={cx('reagent-form-field--wide')}
              type={result.errorCode ? 'error' : 'success'}
              showIcon
              message={`命令状态 ${result.status}`}
              description={
                result.errorCode
                  ? `${result.errorCode}：${result.errorMessage ?? '未提供原因'}`
                  : `已写入 ${result.targets.length} 个目标容器`
              }
            />
          )}
          <ErrorAlert error={error} />
          <div className={cx('modal-actions reagent-form-field--wide')}>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" htmlType="submit" loading={loading}>
              执行分装
            </Button>
          </div>
        </div>
      </Form>
    </Modal>
  )
}

function ImportModal({
  target,
  onClose,
  onSaved,
}: {
  target: 'catalog' | 'inventory'
  onClose: () => void
  onSaved: () => void
}) {
  const { backend } = useBackend()
  const guard = useCapabilityGuard()
  const [file, setFile] = useState<File | null>(null)
  const [atomic, setAtomic] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [result, setResult] = useState<ImportOutcome | null>(null)

  const submit = async () => {
    if (!file) {
      setError(new Error('请先选择要导入的文件'))
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const input = { file, fileName: file.name, atomic }
      if (target === 'catalog') {
        guard('reagentInfo.batchImport')
        setResult(await backend.core.reagentInventory.importReagentInfos(input))
      } else {
        guard('inventory.batchImportReagents')
        setResult(await backend.core.reagentInventory.importReagents(input))
      }
      onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('导入失败'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open
      className={cx('reagent-mutation-modal')}
      width={640}
      title={target === 'catalog' ? '导入试剂目录' : '导入试剂库存'}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          <Button type="primary" loading={loading} onClick={() => void submit()}>
            开始导入
          </Button>
        </Space>
      }
    >
      <div className={cx('reagent-import-body')}>
        <Upload
          maxCount={1}
          accept=".json,.csv,.tsv,.xlsx"
          beforeUpload={(next) => {
            setFile(next as unknown as File)
            // 返回 false 阻止 antd 自行发起上传，文件交由 core 的端口提交。
            return false
          }}
          onRemove={() => setFile(null)}
        >
          <Button>选择 JSON / CSV / TSV / XLSX 文件</Button>
        </Upload>
        <Space align="center">
          <Switch checked={atomic} onChange={setAtomic} />
          <Typography.Text>原子导入</Typography.Text>
        </Space>
        {result && (
          <Alert
            type={result.failed > 0 ? 'warning' : 'success'}
            showIcon
            message={`共 ${result.total} 行，成功 ${result.created} 行，失败 ${result.failed} 行`}
            description={
              result.errors.length ? (
                <List
                  size="small"
                  dataSource={[...result.errors]}
                  renderItem={(row) => (
                    <List.Item>
                      第 {row.row ?? '?'} 行：
                      {row.errors.map((item) => `${item.field} ${item.message}`).join('；')}
                    </List.Item>
                  )}
                />
              ) : (
                '全部记录已写入'
              )
            }
          />
        )}
        <ErrorAlert error={error} />
      </div>
    </Modal>
  )
}
