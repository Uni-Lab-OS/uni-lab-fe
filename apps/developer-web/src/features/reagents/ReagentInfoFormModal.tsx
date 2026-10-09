import { clsx } from 'clsx'
import reagentModalStyles from './ReagentModal.module.scss'
import { Alert, Button, Form, Input, InputNumber, Modal, Select } from 'antd'
import { useState } from 'react'
import type { CompoundLookup } from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'

import {
  ErrorAlert,
  FormSection,
  LOOKUP_TITLES,
  PHYSICAL_STATE_OPTIONS,
  useCapabilityGuard,
  isChineseName,
  text,
} from './reagentModalShared'
import type { ReagentModalState } from './reagentModalShared'

export function InfoFormModal({
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
      className={clsx(reagentModalStyles['reagent-mutation-modal'])}
      width={720}
      title={isCreate ? '新增试剂目录' : `编辑试剂目录 · ${info?.name}`}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      <Form
        form={form}
        className={clsx(reagentModalStyles['reagent-mutation-form'])}
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
        <div className={clsx(reagentModalStyles['reagent-form-grid'])}>
          <FormSection title="化学身份" />
          <Form.Item
            className={clsx(reagentModalStyles['reagent-form-field--wide'])}
            label="CAS 号"
            validateStatus={lookupError ? 'error' : undefined}
            help={lookupError?.message}
          >
            <div className={clsx(reagentModalStyles['reagent-cas-lookup'])}>
              <Form.Item name="cas" noStyle>
                <Input
                  status={lookupError ? 'error' : undefined}
                  className={clsx(reagentModalStyles['reagent-identifier-input'])}
                  placeholder="例如 75-05-8"
                  onChange={() => {
                    setLookup(null)
                    if (lookupError) setLookupError(null)
                  }}
                />
              </Form.Item>
              <Button
                className={clsx(reagentModalStyles['reagent-lookup-button'])}
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
              className={clsx(
                reagentModalStyles['reagent-form-field--wide'],
                reagentModalStyles['reagent-lookup-result'],
              )}
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
          <Form.Item
            className={clsx(reagentModalStyles['reagent-form-field--wide'])}
            label="别名"
            name="aliases"
          >
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
            <Input
              className={clsx(reagentModalStyles['reagent-identifier-input'])}
              placeholder="例如 C2H3N"
            />
          </Form.Item>
          <Form.Item label="分子量 (g/mol)" name="molecularWeight">
            <InputNumber className={clsx(reagentModalStyles['full-input'])} min={0} />
          </Form.Item>
          <Form.Item label="密度 (g/mL)" name="densityGPerMl">
            <InputNumber className={clsx(reagentModalStyles['full-input'])} min={0} />
          </Form.Item>
          <FormSection title="结构标识" />
          <Form.Item label="SMILES" name="smiles">
            <Input
              className={clsx(reagentModalStyles['reagent-identifier-input'])}
              placeholder="例如 CC#N"
            />
          </Form.Item>
          <Form.Item label="InChIKey" name="inchiKey">
            <Input
              className={clsx(reagentModalStyles['reagent-identifier-input'])}
              placeholder="例如 WEVYAHXRMPXWCK-UHFFFAOYSA-N"
            />
          </Form.Item>
          <FormSection title="备注" />
          <Form.Item
            className={clsx(reagentModalStyles['reagent-form-field--wide'])}
            label="描述"
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
