import { clsx } from 'clsx'
import reagentModalStyles from './ReagentModal.module.scss'
import { Alert, Button, DatePicker, Form, Input, InputNumber, Modal, Select } from 'antd'
import { useState } from 'react'
import type { MaterialSummary, ReagentInfo } from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import { CAPACITY_UNIT_OPTIONS, defaultCapacityUnit, formatCapacity } from './reagentCapacity'

import {
  AmountField,
  CONCENTRATION_UNITS,
  ContainerSelect,
  ErrorAlert,
  FormSection,
  PHYSICAL_STATE_OPTIONS,
  QUANTITY_UNITS,
  useCapabilityGuard,
  readCapacity,
  readObservedAt,
  text,
} from './reagentModalShared'
import type { ReagentModalState } from './reagentModalShared'

export function InventoryFormModal({
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
      className={clsx(reagentModalStyles['reagent-mutation-modal'])}
      width={720}
      title={isCreate ? '录入试剂库存' : `编辑试剂库存 · ${reagent?.name}`}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      <Form
        form={form}
        className={clsx(reagentModalStyles['reagent-mutation-form'])}
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
        <div className={clsx(reagentModalStyles['reagent-form-grid'])}>
          <FormSection title="容器与身份" />
          <Form.Item
            className={clsx(reagentModalStyles['reagent-form-field--wide'])}
            label="容器物料"
            name="materialUuid"
            rules={[{ required: true, message: '请选择承载试剂的容器物料' }]}
          >
            <ContainerSelect materials={materials} disabled={!isCreate} />
          </Form.Item>
          {isCreate &&
            (presetInfo ? (
              <Form.Item
                className={clsx(reagentModalStyles['reagent-form-field--wide'])}
                label="试剂身份"
              >
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
              <InputNumber className={clsx(reagentModalStyles['full-input'])} min={0} />
            </Form.Item>
          )}
          <FormSection title="容器装料上限" />
          {reagent && (
            <Alert
              className={clsx(
                reagentModalStyles['reagent-form-field--wide'],
                reagentModalStyles['reagent-capacity-note'],
              )}
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
            <DatePicker
              className={clsx(reagentModalStyles['full-input'])}
              showTime
              placeholder="选择时间"
            />
          </Form.Item>
          <Form.Item
            className={clsx(reagentModalStyles['reagent-form-field--wide'])}
            label="说明"
            name="description"
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <ErrorAlert error={error} />
          <div className={clsx(reagentModalStyles['reagent-form-field--wide'])}>
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
