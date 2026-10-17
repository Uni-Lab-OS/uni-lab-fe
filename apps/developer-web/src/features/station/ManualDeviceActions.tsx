import { clsx } from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Input, Popconfirm, Select, Tag } from 'antd'
import type {
  DeviceSummary,
  StationDeviceAction,
  StationError,
  StationHandlingSession,
  StationHandlingSnapshot,
  StationManualAction,
} from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import type { StationHandlingState } from './useStationHandling'
import styles from './StationErrorHandling.module.scss'

const STATUS_LABELS: Record<string, string> = {
  pending: '待派发',
  dispatched: '已派发',
  running: '执行中',
  succeeded: '已完成',
  failed: '失败',
  canceled: '已取消',
  timeout: '超时',
}

/** 出错作业的实际执行设备（物料 UUID），作为手动动作的默认设备。 */
function failedDevice(controlData: Readonly<Record<string, unknown>> | undefined): string | null {
  const actual = controlData?.actual_executor
  if (!actual || typeof actual !== 'object') return null
  const uuid = (actual as Record<string, unknown>).material_uuid
  return typeof uuid === 'string' && uuid ? uuid : null
}

/**
 * 人工处置会话中的手动设备动作：例如工位卡在 RUNNING 时执行“复位（清 L2 故障）”。
 * 动作会真实驱动设备，下发前须确认现场安全；动作目录与版本来自 OS，参数以 JSON 填写并带默认值。
 * 结果未知的动作需现场核对并登记，之后才能完成本次手动处理。
 */
export function ManualDeviceActions({
  snapshot,
  session,
  error,
  state,
  writable,
}: {
  snapshot: StationHandlingSnapshot
  session: StationHandlingSession
  error: StationError
  state: StationHandlingState
  writable: boolean
}) {
  const { backend } = useBackend()
  const port = backend.core.stationErrorHandling
  const [devices, setDevices] = useState<readonly DeviceSummary[]>([])
  const [deviceUuid, setDeviceUuid] = useState<string | null>(null)
  const [actions, setActions] = useState<readonly StationDeviceAction[]>([])
  const [actionId, setActionId] = useState<string | null>(null)
  const [paramsText, setParamsText] = useState('{}')
  const [safe, setSafe] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([
      backend.core.deviceActions.listDevices(),
      backend.core.executionRead.getNodeJobDetail(error.sourceJobUuid).catch(() => null),
    ]).then(
      ([list, job]) => {
        if (!live) return
        setDevices(list)
        const fallback = failedDevice(job?.controlData)
        setDeviceUuid(
          (current) =>
            current ?? (list.some((item) => item.materialUuid === fallback) ? fallback : null),
        )
      },
      (cause: unknown) =>
        live && setLoadError(cause instanceof Error ? cause.message : '读取设备列表失败'),
    )
    return () => {
      live = false
    }
  }, [backend, error.sourceJobUuid])

  useEffect(() => {
    if (!deviceUuid) return
    let live = true
    setActions([])
    setActionId(null)
    port.listDeviceActions(session.sessionId, deviceUuid).then(
      (next) => {
        if (!live) return
        setActions(next)
        setLoadError(null)
      },
      (cause: unknown) =>
        live && setLoadError(cause instanceof Error ? cause.message : '读取设备动作失败'),
    )
    return () => {
      live = false
    }
  }, [deviceUuid, port, session.sessionId])

  const action = actions.find((item) => item.actionId === actionId) ?? null
  useEffect(() => {
    setParamsText(JSON.stringify(action?.defaults ?? {}, null, 2))
    setSafe(false)
  }, [action])

  const parsed = useMemo(() => {
    try {
      const value: unknown = JSON.parse(paramsText || '{}')
      return value && typeof value === 'object' && !Array.isArray(value)
        ? { value: value as Record<string, unknown>, error: null }
        : { value: null, error: '参数必须是 JSON 对象' }
    } catch {
      return { value: null, error: '参数不是合法的 JSON' }
    }
  }, [paramsText])

  const device = devices.find((item) => item.materialUuid === deviceUuid) ?? null
  const mine = snapshot.manualActions.filter((item) => item.sessionId === session.sessionId)
  const canSubmit = writable && Boolean(device && action && parsed.value) && safe

  return (
    <section className={clsx(styles.occupancies)} aria-label="手动设备动作">
      <strong>手动设备动作</strong>
      <p className={clsx(styles.hint)}>
        例如工位卡在运行中时执行“复位（清故障）”。动作会立即驱动真实设备，下发前请确认现场人员与物料安全。
      </p>
      {loadError && <Alert type="warning" showIcon message={loadError} />}
      <label className={clsx(styles.field)}>
        <span>设备</span>
        <Select
          showSearch
          optionFilterProp="label"
          value={deviceUuid ?? undefined}
          placeholder="选择设备"
          disabled={!writable}
          onChange={setDeviceUuid}
          options={devices.map((item) => ({
            value: item.materialUuid,
            label: `${item.label || item.deviceKey}${item.deviceKey && item.label !== item.deviceKey ? `（${item.deviceKey}）` : ''}`,
          }))}
        />
      </label>
      {deviceUuid && (
        <label className={clsx(styles.field)}>
          <span>动作（{actions.length} 个）</span>
          <Select
            showSearch
            optionFilterProp="label"
            value={actionId ?? undefined}
            placeholder="选择动作"
            disabled={!writable || actions.length === 0}
            onChange={setActionId}
            options={actions.map((item) => ({ value: item.actionId, label: item.displayName }))}
          />
        </label>
      )}
      {action && (
        <>
          <label className={clsx(styles.field)}>
            <span>参数（JSON，已填入默认值）</span>
            <Input.TextArea
              rows={4}
              value={paramsText}
              disabled={!writable}
              onChange={(event) => setParamsText(event.target.value)}
              style={{ fontFamily: 'monospace' }}
            />
          </label>
          {parsed.error && <p className={clsx(styles.hint)}>{parsed.error}</p>}
          <Checkbox
            checked={safe}
            disabled={!writable}
            onChange={(event) => setSafe(event.target.checked)}
          >
            我已确认现场安全，可以驱动该设备
          </Checkbox>
          <div>
            <Popconfirm
              title={`将立即驱动 ${device?.label || device?.deviceKey || '设备'} 执行「${action.displayName}」，确认下发？`}
              okText="确认下发"
              cancelText="再看看"
              disabled={!canSubmit}
              onConfirm={() => {
                if (!device || !parsed.value) return
                void state
                  .submit(
                    port.manualActionIntent(
                      snapshot,
                      session,
                      device.materialUuid,
                      action,
                      parsed.value,
                    ),
                  )
                  .then((ok) => ok && setSafe(false))
              }}
            >
              <Button type="primary" disabled={!canSubmit}>
                下发手动动作
              </Button>
            </Popconfirm>
          </div>
        </>
      )}
      {mine.length > 0 && (
        <div className={clsx(styles.occupancyList)}>
          {mine.map((item) => (
            <ManualActionRow
              key={item.jobUuid}
              item={item}
              snapshot={snapshot}
              session={session}
              state={state}
              writable={writable}
              deviceName={
                devices.find((d) => d.materialUuid === item.deviceId)?.label ?? item.deviceId
              }
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ManualActionRow({
  item,
  snapshot,
  session,
  state,
  writable,
  deviceName,
}: {
  item: StationManualAction
  snapshot: StationHandlingSnapshot
  session: StationHandlingSession
  state: StationHandlingState
  writable: boolean
  deviceName: string
}) {
  const { backend } = useBackend()
  const port = backend.core.stationErrorHandling
  const [reason, setReason] = useState('')
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const uncertain = Boolean(item.uncertaintyReason)
  const terminal = ['succeeded', 'failed', 'canceled', 'timeout'].includes(item.status)
  // 结果未知且仍未结束：先按“已取消”收尾（与普通作业相同的 OS 处置），结束后再登记核对结论。
  const needsResolve = uncertain && !terminal
  const needsReview = uncertain && terminal && !item.resultReviewed
  const resolve = async () => {
    setResolving(true)
    setResolveError(null)
    try {
      await backend.core.executionRecovery.resolveUncertainJob(item.jobUuid, reason)
    } catch (cause) {
      setResolveError(cause instanceof Error ? cause.message : '提交收尾失败')
    } finally {
      setResolving(false)
      await state.reload()
    }
  }
  return (
    <div>
      <Tag
        color={item.status === 'succeeded' ? 'green' : item.status === 'failed' ? 'red' : 'default'}
      >
        {STATUS_LABELS[item.status] ?? item.status}
      </Tag>
      {deviceName} · {item.actionName || '动作'}
      {item.errorMessage && <p className={clsx(styles.hint)}>{item.errorMessage}</p>}
      {needsResolve && (
        <div className={clsx(styles.field)}>
          <span>
            结果未知（{item.uncertaintyReason}
            ），请现场核对动作是否执行；未执行或已安全停止时按“已取消”收尾
          </span>
          <Input
            value={reason}
            disabled={!writable || resolving}
            placeholder="例如：现场确认工位未动作、无板"
            onChange={(event) => setReason(event.target.value)}
          />
          {resolveError && <p className={clsx(styles.hint)}>{resolveError}</p>}
          <div>
            <Popconfirm
              title="仅在现场确认该动作未执行或已安全停止时提交，提交后按“已取消”收尾。"
              okText="确认收尾"
              cancelText="再核对"
              disabled={!writable || !reason.trim()}
              onConfirm={() => void resolve()}
            >
              <Button size="small" loading={resolving} disabled={!writable || !reason.trim()}>
                现场已核对，按已取消收尾
              </Button>
            </Popconfirm>
          </div>
        </div>
      )}
      {needsReview && (
        <div className={clsx(styles.field)}>
          <span>结果未知（{item.uncertaintyReason}），请现场核对后登记结论</span>
          <Input
            value={reason}
            disabled={!writable}
            placeholder="例如：现场确认工位已回到原位、无板"
            onChange={(event) => setReason(event.target.value)}
          />
          <div>
            <Button
              size="small"
              disabled={!writable || !reason.trim()}
              onClick={() =>
                void state.submit(port.reviewManualActionIntent(snapshot, session, item, reason))
              }
            >
              登记核对结论
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
