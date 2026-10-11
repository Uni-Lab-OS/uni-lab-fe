import { clsx } from 'clsx'
import reagentModalStyles from './ReagentModal.module.scss'
import { Alert, Button, Form, Input, InputNumber, Modal, Select } from 'antd'
import { useRef, useState } from 'react'
import type { Reagent, ReagentDispenseResult } from '@unilab-fe/core'
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

function DispenseQuantity({
  unit,
  value,
  onChange,
}: {
  unit: string
  value?: number | null
  onChange?: (next: number | null) => void
}) {
  return (
    <div className={clsx(reagentModalStyles['reagent-amount-field'])}>
      <InputNumber
        className={clsx(reagentModalStyles['reagent-amount-value'])}
        min={0}
        controls={false}
        placeholder="数量"
        value={value}
        onChange={(next) => onChange?.(typeof next === 'number' ? next : null)}
      />
      <span className={clsx(reagentModalStyles['reagent-amount-suffix'])}>{unit}</span>
    </div>
  )
}

export function DispenseModal({
  reagent,
  onClose,
  onSaved,
}: {
  reagent: Reagent
  onClose: () => void
  onSaved: () => void
}) {
  const { backend } = useBackend()
  const guard = useCapabilityGuard()
  const [form] = Form.useForm<Record<string, unknown>>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [result, setResult] = useState<ReagentDispenseResult | null>(null)
  const watchedUnit = Form.useWatch('quantityUnit', form)
  const quantityUnit =
    typeof watchedUnit === 'string' && watchedUnit ? watchedUnit : (reagent.quantityUnit ?? 'mL')
  const commandId = useRef(crypto.randomUUID())

  const submit = async (values: Record<string, unknown>) => {
    if (result?.status === 'rejected') commandId.current = crypto.randomUUID()
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
      className={clsx(reagentModalStyles['reagent-mutation-modal'])}
      width={720}
      title={`试剂分装 · ${reagent.name}`}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      <Alert
        className={clsx(reagentModalStyles['reagent-dispense-source'])}
        type="info"
        showIcon
        message={`源瓶余量 ${reagent.quantity ?? '未提供'} ${reagent.quantityUnit ?? ''}`}
      />
      <Form
        form={form}
        className={clsx(reagentModalStyles['reagent-mutation-form'])}
        layout="vertical"
        initialValues={{
          quantityUnit: reagent.quantityUnit ?? 'mL',
          targets: [{}],
          capacityUnit: defaultCapacityUnit(reagent.quantityUnit),
        }}
        onFinish={submit}
      >
        <div className={clsx(reagentModalStyles['reagent-form-grid'])}>
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
            required
            positive
            unitOptions={CAPACITY_UNIT_OPTIONS}
          />
          <Form.List name="targets">
            {(fields, { add, remove }) => (
              <div
                className={clsx(
                  reagentModalStyles['reagent-form-field--wide'],
                  reagentModalStyles['reagent-dispense-targets'],
                )}
              >
                {fields.map((field, index) => (
                  <div
                    className={clsx(reagentModalStyles['reagent-dispense-target'])}
                    key={field.key}
                  >
                    <Form.Item
                      name={[field.name, 'materialUuid']}
                      label={index === 0 ? '目标容器' : undefined}
                      rules={[{ required: true, message: '请选择目标容器' }]}
                    >
                      <ContainerSelect excludeMaterialUuid={reagent.materialUuid} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'quantity']}
                      label={index === 0 ? '分装量' : undefined}
                      rules={[{ required: true, message: '请输入分装量' }]}
                    >
                      <DispenseQuantity unit={quantityUnit} />
                    </Form.Item>
                    <Button
                      className={clsx(
                        reagentModalStyles['reagent-dispense-remove'],
                        index === 0 && reagentModalStyles['reagent-dispense-remove--labeled'],
                      )}
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
              className={clsx(
                reagentModalStyles['reagent-form-field--wide'],
                reagentModalStyles['reagent-dispense-result'],
              )}
              type={result.errorCode ? 'error' : 'success'}
              showIcon
              message={
                result.errorCode
                  ? (result.errorMessage ?? '分装被拒绝，服务端没有返回原因')
                  : `已写入 ${result.targets.length} 个目标容器`
              }
              description={result.errorCode ? `错误码 ${result.errorCode}` : undefined}
            />
          )}
          <div
            className={clsx(
              reagentModalStyles['reagent-form-field--wide'],
              reagentModalStyles['reagent-form-footer'],
            )}
          >
            <ErrorAlert error={error} />
            <div className={clsx(reagentModalStyles['reagent-form-actions'])}>
              <Button onClick={onClose}>取消</Button>
              <Button type="primary" htmlType="submit" loading={loading}>
                执行分装
              </Button>
            </div>
          </div>
        </div>
      </Form>
    </Modal>
  )
}
