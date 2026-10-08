import { cx } from './reagentModalClassNames'
import { Alert, Button, Form, Input, InputNumber, Modal, Select } from 'antd'
import { useRef, useState } from 'react'
import type { MaterialSummary, Reagent, ReagentDispenseResult } from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import { CAPACITY_UNIT_OPTIONS, defaultCapacityUnit } from './reagentCapacity'

import {
  AmountField,
  ContainerSelect,
  ErrorAlert,
  FormSection,
  QUANTITY_UNITS,
  useCapabilityGuard,
  readCapacity,
  text,
} from './reagentModalShared'

export function DispenseModal({
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
