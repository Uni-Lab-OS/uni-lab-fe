import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Alert, Button, Checkbox, Form, Input, Select } from 'antd'
import { DeviceActionParameterFields } from '@unilab/lab-ui'
import {
  deviceActionParametersFromSchema,
  normalizeDeviceActionParameters,
  type StationHandlingSession,
} from '@unilab-fe/core'
import { useBackendQuery } from '../../hooks/useBackendQuery'
import stationStyles from './stationHandling.module.scss'
import type { ManualHandlingDraft } from './manualHandlingDraft'
import type { ManualOperationIntent } from './useManualHandling'

interface FormProps {
  readonly session: StationHandlingSession
  /** 这条错误所属的任务：用来判断设备占用是不是「别的任务」持有的。 */
  readonly sourceTaskUuid: string
  readonly draft: ManualHandlingDraft
  readonly updateDraft: (patch: Partial<ManualHandlingDraft>) => void
  readonly pending: boolean
  readonly onSubmit: (intent: ManualOperationIntent) => Promise<boolean>
  readonly onDone: () => void
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/* ── 设备动作 ─────────────────────────────────────────── */

/**
 * 手动执行设备动作。
 *
 * 这里**没有**「本任务相关 / 其它设备」的分层：前端拿不到可靠的任务-设备归属，
 * 编一个分组只会让人误以为系统知道哪些设备是相关的。取而代之的是用设备自己的
 * **真实占用**判定 —— 这台设备正被**别的任务**占着时才要求额外确认，并点名是谁。
 */
export function DeviceActionForm({
  session,
  sourceTaskUuid,
  draft,
  updateDraft,
  pending,
  onSubmit,
  onDone,
}: FormProps) {
  const [form] = Form.useForm()
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({})
  const [parameterError, setParameterError] = useState<string | null>(null)
  const [ack, setAck] = useState(false)
  const devicesQuery = useBackendQuery('manual-devices', (backend) =>
    backend.core.deviceActions.listDevices(),
  )
  const catalogueQuery = useBackendQuery(
    `manual-device-actions-${session.sessionId}-${draft.deviceId}`,
    (backend) =>
      draft.deviceId
        ? backend.core.stationErrorHandling.listManualDeviceActions(
            session.sessionId,
            draft.deviceId,
          )
        : Promise.resolve([]),
  )

  const devices = devicesQuery.data ?? []
  const device = devices.find((item) => item.materialUuid === draft.deviceId)
  // 别的任务通过执行占用拿着这台设备 —— 手动动作会绕过那个占用。
  const foreignOccupancy = device?.executionOccupancies?.find(
    (occupancy) =>
      occupancy.workflowTaskUuid != null && occupancy.workflowTaskUuid !== sourceTaskUuid,
  )
  const actions = catalogueQuery.data ?? []
  const action = actions.find((item) => item.actionId === draft.actionId)
  const parameters = useMemo(
    () => (action ? deviceActionParametersFromSchema(action.parameterSchema) : []),
    [action],
  )

  const submit = async () => {
    if (!action) return
    let payload: Record<string, unknown>
    try {
      payload = normalizeDeviceActionParameters(parameterValues, parameters)
    } catch (cause) {
      setParameterError(cause instanceof Error ? cause.message : '动作参数无效')
      return
    }
    setParameterError(null)
    const label = [device?.label, action.displayName || action.name].filter(Boolean).join(' · ')
    const done = await onSubmit({
      kind: 'device',
      label: label || '手动设备动作',
      deviceId: draft.deviceId,
      actionId: action.actionId,
      actionVersion: action.actionVersion,
      parameters: payload,
    })
    if (done) {
      setParameterValues({})
      setAck(false)
      onDone()
    }
  }

  return (
    <Form
      form={form}
      layout="vertical"
      className={clsx(stationStyles['manual-form'])}
      onFinish={() => void submit()}
    >
      <Alert
        type="info"
        showIcon
        className={clsx(stationStyles['manual-form-wide'])}
        message="手动动作不检查逻辑锁，可以作用在别的任务正在使用的设备上。"
      />
      <Form.Item label="设备" required>
        <Select
          value={draft.deviceId || undefined}
          placeholder={devicesQuery.loading ? '正在读取设备…' : '选择设备'}
          loading={devicesQuery.loading}
          disabled={devicesQuery.error != null}
          onChange={(value: string) => {
            updateDraft({ deviceId: value, actionId: '', parameters: {} })
            setParameterValues({})
            setAck(false)
          }}
          options={devices.map((item) => ({
            value: item.materialUuid,
            label: `${item.label}${item.online === false ? '（离线）' : ''}`,
          }))}
        />
      </Form.Item>
      <Form.Item label="动作" required>
        <Select
          value={draft.actionId || undefined}
          placeholder={catalogueQuery.loading ? '正在读取动作…' : '选择动作'}
          loading={catalogueQuery.loading}
          disabled={!draft.deviceId || catalogueQuery.error != null}
          onChange={(value: string) => {
            updateDraft({ actionId: value })
            const selected = actions.find((item) => item.actionId === value)
            setParameterValues(selected?.defaults ?? {})
            setAck(false)
          }}
          options={actions.map((item) => ({
            value: item.actionId,
            label: item.displayName || item.name,
          }))}
        />
      </Form.Item>
      {action && parameters.length > 0 && (
        <DeviceActionParameterFields
          parameters={parameters}
          value={parameterValues}
          className={clsx(stationStyles['manual-form-wide'])}
          onChange={(name, next) => setParameterValues((current) => ({ ...current, [name]: next }))}
        />
      )}
      {foreignOccupancy && (
        <Alert
          type="warning"
          showIcon
          className={clsx(stationStyles['manual-form-wide'])}
          message="这台设备正被另一个任务占用"
          description={`${device?.label ?? '设备'} 的${foreignOccupancy.actionName ?? '执行占用'}被 task ${foreignOccupancy.workflowTaskUuid ?? '未知'} 持有（${foreignOccupancy.state}）。手动动作会绕过那个占用。`}
        />
      )}
      {foreignOccupancy && (
        <Checkbox
          className={clsx(stationStyles['manual-form-wide'])}
          checked={ack}
          onChange={(event) => setAck(event.target.checked)}
        >
          我知道，仍然继续
        </Checkbox>
      )}
      {parameterError && (
        <Alert
          type="error"
          showIcon
          className={clsx(stationStyles['manual-form-wide'])}
          message={parameterError}
        />
      )}
      {devicesQuery.error && (
        <Alert
          type="error"
          showIcon
          className={clsx(stationStyles['manual-form-wide'])}
          message={`设备目录读取失败：${devicesQuery.error.message}`}
        />
      )}
      {catalogueQuery.error && (
        <Alert
          type="error"
          showIcon
          className={clsx(stationStyles['manual-form-wide'])}
          message={`动作目录读取失败：${catalogueQuery.error.message}`}
        />
      )}
      <div
        className={clsx(stationStyles['manual-form-wide'], stationStyles['manual-form-actions'])}
      >
        <Button onClick={onDone}>取消</Button>
        <Button
          type="primary"
          htmlType="submit"
          loading={pending}
          disabled={!action || (foreignOccupancy != null && !ack)}
        >
          执行动作
        </Button>
      </div>
    </Form>
  )
}

/* ── 物料位置 ─────────────────────────────────────────── */

/**
 * 登记物料实际位置。
 *
 * 系统当前的认知**预填在表单里**：先说清它以为东西在哪，人只需要改成实际的。
 * 不做成「先对一遍账」的独立步骤 —— 那会逼人从零填一遍世界。
 */
export function MaterialPositionForm({
  session,
  draft,
  updateDraft,
  pending,
  onSubmit,
  onDone,
}: FormProps) {
  const [form] = Form.useForm()
  const inventoryQuery = useBackendQuery(`manual-inventory-${session.sessionId}`, (backend) =>
    backend.core.stationErrorHandling.getHandlingInventory(session.sessionId),
  )
  const instances = inventoryQuery.data?.instances ?? []
  const sites = inventoryQuery.data?.sites ?? []
  const material = instances.find((item) => item.edgeUuid === draft.materialUuid)
  const targetSites = sites.filter((site) => site.materialUuid === draft.parentUuid)

  const submit = async () => {
    if (!material || !text(draft.materialReason)) return
    // 版本要同时覆盖被移动的物料与它的目标库位：OS 是整批原子校验，任一项过期就整批拒绝。
    const versions: Record<string, string | number> = { [material.edgeUuid]: material.version }
    if (draft.siteUuid) {
      const site = sites.find((item) => item.siteUuid === draft.siteUuid)
      if (!site) return
      versions[site.siteUuid] = site.updateTime
    }
    const target = draft.siteUuid
      ? (sites.find((item) => item.siteUuid === draft.siteUuid)?.name ?? draft.siteUuid)
      : draft.parentUuid
        ? '未指定库位'
        : '移出当前库位'
    const done = await onSubmit({
      kind: 'material',
      label: `${material.name} → ${target}`,
      changes: [
        {
          materialUuid: material.edgeUuid,
          parentUuid: draft.parentUuid,
          siteUuid: draft.siteUuid,
        },
      ],
      expectedVersions: versions,
      reason: text(draft.materialReason),
    })
    if (done) {
      updateDraft({ materialUuid: '', parentUuid: '', siteUuid: '', materialReason: '' })
      onDone()
    }
  }

  return (
    <Form
      form={form}
      layout="vertical"
      className={clsx(stationStyles['manual-form'])}
      onFinish={() => void submit()}
    >
      {inventoryQuery.error && (
        <Alert
          type="error"
          showIcon
          className={clsx(stationStyles['manual-form-wide'])}
          message={`库存读取失败：${inventoryQuery.error.message}`}
        />
      )}
      <Form.Item label="物料" required>
        <Select
          value={draft.materialUuid || undefined}
          placeholder={inventoryQuery.loading ? '正在读取物料…' : '选择物料'}
          loading={inventoryQuery.loading}
          onChange={(value: string) => {
            updateDraft({ materialUuid: value, parentUuid: '', siteUuid: '' })
          }}
          options={instances.map((item) => ({ value: item.edgeUuid, label: item.name }))}
        />
      </Form.Item>
      {material && (
        <Alert
          type="info"
          showIcon
          className={clsx(stationStyles['manual-form-wide'])}
          message={`系统现在认为 ${material.name} 在 ${
            instances.find((item) => item.edgeUuid === material.parentUuid)?.name ?? '未记录的容器'
          }`}
        />
      )}
      <Form.Item label="实际位置">
        <Select
          value={draft.parentUuid}
          disabled={!material}
          onChange={(value: string) => updateDraft({ parentUuid: value, siteUuid: '' })}
          options={[
            { value: '', label: '移出当前库位' },
            ...instances
              .filter((item) => item.edgeUuid !== draft.materialUuid)
              .map((item) => ({ value: item.edgeUuid, label: item.name })),
          ]}
        />
      </Form.Item>
      <Form.Item label="库位">
        <Select
          value={draft.siteUuid}
          disabled={!draft.parentUuid}
          onChange={(value: string) => updateDraft({ siteUuid: value })}
          options={[
            { value: '', label: '不指定库位' },
            ...targetSites.map((site) => ({
              value: site.siteUuid,
              label: `${site.name}${site.occupiedMaterialUuid ? '（已有物料）' : ''}`,
            })),
          ]}
        />
      </Form.Item>
      <Form.Item
        label="登记原因"
        name="reason"
        required
        rules={[{ required: true, message: '请填写登记原因' }]}
      >
        <Input
          value={draft.materialReason}
          onChange={(event) => updateDraft({ materialReason: event.target.value })}
        />
      </Form.Item>
      <div
        className={clsx(stationStyles['manual-form-wide'], stationStyles['manual-form-actions'])}
      >
        <Button onClick={onDone}>取消</Button>
        <Button
          type="primary"
          htmlType="submit"
          loading={pending}
          disabled={!material || !text(draft.materialReason)}
        >
          登记物料位置
        </Button>
      </div>
    </Form>
  )
}

/* ── 释放占用 ─────────────────────────────────────────── */

/**
 * 释放选中的逻辑占用。
 *
 * 多选是 OS 的原生用法（`occupancy_ids` 是列表，整批原子校验），所以这里一个原因
 * 覆盖一整批，一条结果就够。列表中同一个 `lock_key` 可能属于不同任务，
 * 所以必须把持有者显示出来，否则人分不清该选哪个。
 */
export function OccupancyReleaseForm({
  draft,
  updateDraft,
  pending,
  onSubmit,
  onDone,
}: Omit<FormProps, 'session' | 'sourceTaskUuid'>) {
  const [form] = Form.useForm()
  const query = useBackendQuery('manual-occupancies', (backend) =>
    backend.core.stationErrorHandling.listResourceOccupancies(),
  )
  const occupancies = query.data ?? []
  const selected = new Set(draft.occupancyIds)

  const submit = async () => {
    const picked = occupancies.filter((item) => selected.has(item.occupancyUuid))
    if (picked.length === 0 || !text(draft.occupancyReason)) return
    const done = await onSubmit({
      kind: 'occupancy',
      label:
        picked.length === 1
          ? `释放 ${picked[0].lockKey}`
          : `释放 ${picked.length} 个占用 · ${picked.map((item) => item.lockKey).join('、')}`,
      occupancyIds: picked.map((item) => item.occupancyUuid),
      expectedVersions: Object.fromEntries(
        picked.map((item) => [item.occupancyUuid, item.version]),
      ),
      reason: text(draft.occupancyReason),
    })
    if (done) {
      updateDraft({ occupancyIds: [], occupancyReason: '' })
      onDone()
    }
  }

  return (
    <Form
      form={form}
      layout="vertical"
      className={clsx(stationStyles['manual-form'])}
      onFinish={() => void submit()}
    >
      {query.error && (
        <Alert
          type="error"
          showIcon
          className={clsx(stationStyles['manual-form-wide'])}
          message={`逻辑占用读取失败：${query.error.message}`}
        />
      )}
      <Form.Item label="要释放的占用" required>
        {occupancies.length === 0 ? (
          <p className={clsx(stationStyles['manual-empty-line'])}>
            {query.loading ? '正在读取逻辑占用…' : '当前没有逻辑占用。'}
          </p>
        ) : (
          <div className={clsx(stationStyles['manual-pick-list'])}>
            {occupancies.map((item) => (
              <label key={item.occupancyUuid} className={clsx(stationStyles['manual-pick-row'])}>
                <Checkbox
                  checked={selected.has(item.occupancyUuid)}
                  onChange={(event) =>
                    updateDraft({
                      occupancyIds: event.target.checked
                        ? [...draft.occupancyIds, item.occupancyUuid]
                        : draft.occupancyIds.filter((id) => id !== item.occupancyUuid),
                    })
                  }
                />
                <span className={clsx(stationStyles['manual-pick-main'])}>
                  <strong>{item.lockKey}</strong>
                  <small>
                    {item.occupancyKind === 'device_tenancy' ? '设备占用' : '执行占用'} ·{' '}
                    {item.state}
                    {item.taskUuid ? ` · task ${item.taskUuid.slice(0, 8)}` : ''}
                  </small>
                </span>
              </label>
            ))}
          </div>
        )}
      </Form.Item>
      <Form.Item
        label="释放原因"
        name="reason"
        required
        rules={[{ required: true, message: '请填写释放原因' }]}
      >
        <Input
          value={draft.occupancyReason}
          onChange={(event) => updateDraft({ occupancyReason: event.target.value })}
        />
      </Form.Item>
      <div
        className={clsx(stationStyles['manual-form-wide'], stationStyles['manual-form-actions'])}
      >
        <Button onClick={onDone}>取消</Button>
        <Button
          type="primary"
          htmlType="submit"
          danger
          loading={pending}
          disabled={draft.occupancyIds.length === 0 || !text(draft.occupancyReason)}
        >
          {draft.occupancyIds.length > 0
            ? `释放选中的 ${draft.occupancyIds.length} 个占用`
            : '释放选中的占用'}
        </Button>
      </div>
    </Form>
  )
}
