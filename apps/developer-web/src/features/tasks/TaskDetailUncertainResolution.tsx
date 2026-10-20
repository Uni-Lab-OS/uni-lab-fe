import { useState } from 'react'
import { clsx } from 'clsx'
import { Alert, Button, Input, Popconfirm } from 'antd'
import type { WorkflowNodeJobDetail } from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import { readManualResolution } from './actionRetryGuard'
import styles from './TaskHumanInteraction.module.scss'

/** 结果未知且仍占用资源、可由操作员处置的作业：运行中或失败，并带有 OS 的不确定原因。 */
export function needsUncertainResolution(job: WorkflowNodeJobDetail | null): boolean {
  return Boolean(job?.uncertaintyReason) && (job?.status === 'running' || job?.status === 'failed')
}

/**
 * “结果未知”作业的人工处置。设备动作超时或未确认时，OS 保持占用并阻止再向该设备派发；
 * 操作员现场确认动作未执行或已安全停止后，才可请求按“已取消”收尾。OS 只接受这一结论，
 * 不能把未知结果人工改成成功。请求受理后仍需设备侧确认，最终状态以 OS 为准。
 */
export function UncertainJobResolution({
  job,
  onResolve,
}: {
  job: WorkflowNodeJobDetail | null
  onResolve: (jobUuid: string, reason: string) => Promise<void>
}) {
  const { backend } = useBackend()
  const capability = backend.getCapabilityStatus('workflow.resolveUncertain')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!job || !needsUncertainResolution(job)) return null
  const requested = readManualResolution(job)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await onResolve(job.jobUuid, reason)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提交处置失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={clsx(styles['uncertain'])} aria-label="结果未知处置">
      <Alert
        type="warning"
        showIcon
        message="设备动作结果未知，需现场核对"
        description={`OS 原因：${job.uncertaintyReason}。该设备在处置前不会再接收新动作。不要直接重发同一动作。`}
      />
      {requested ? (
        <Alert
          type="info"
          showIcon
          message="已请求按“已取消”收尾，等待设备侧确认"
          description={`核对结论：${requested.reason || '（未提供）'}。设备包确认后 OS 结算作业并释放占用。`}
        />
      ) : !capability.available ? (
        <Alert
          type="error"
          showIcon
          message="当前后端未声明结果未知处置能力"
          description={`${capability.reason ?? ''}。请按现场流程处理，不要自行释放占用。`}
        />
      ) : (
        <>
          <label className={clsx(styles['field'])}>
            <span>现场核对结论（必填，写入 OS 与设备命令日志）</span>
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 5 }}
              maxLength={500}
              value={reason}
              placeholder="例如：现场确认夹爪未动作，工位无板，已复位"
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {error && <Alert type="error" showIcon message="OS 未受理处置" description={error} />}
          <div className={clsx(styles['actions'])}>
            <Popconfirm
              title="仅在现场确认该动作未执行或已安全停止时提交。提交后作业按“已取消”收尾，后续步骤不会继续执行。"
              okText="确认提交"
              cancelText="再核对"
              onConfirm={() => void submit()}
              disabled={!reason.trim()}
            >
              <Button danger loading={busy} disabled={!reason.trim()}>
                现场已核对，按已取消收尾
              </Button>
            </Popconfirm>
          </div>
        </>
      )}
    </section>
  )
}
