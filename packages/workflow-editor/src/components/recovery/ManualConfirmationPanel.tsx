import { useEffect, useRef, useState } from 'react'
import type { WorkflowNodeJob, WorkflowRecoveryPort } from '@unilab/services'

const labels: Record<string, string> = { pending: '等待人工确认', approved: '已批准', rejected: '已拒绝', timed_out: '确认已超时', canceled: '确认已取消' }
export function confirmationActions(job: WorkflowNodeJob, writable: boolean): Array<'approve' | 'reject'> {
  const confirmation = job.manual_confirmation
  if (!writable || !confirmation || confirmation.status !== 'pending') return []
  const deadline = confirmation.deadline_at ? Date.parse(confirmation.deadline_at) : NaN
  if (Number.isFinite(deadline) && deadline <= Date.now()) return []
  return (confirmation.actions || []).filter((action) => action === 'approve' || action === 'reject')
}
export function ManualConfirmationPanel({ jobs, names, port, writable, refresh }: {
  jobs: readonly WorkflowNodeJob[]; names: Record<string, string>; port: WorkflowRecoveryPort; writable: boolean; refresh: () => Promise<void>
}) {
  const confirmations = jobs.filter((job) => job.manual_confirmation)
  if (!confirmations.length) return null
  return <section aria-label="人工确认节点"><h3>人工确认节点</h3>{confirmations.map((job) => <ConfirmationRow key={job.uuid} job={job} name={names[job.workflow_node_uuid] || job.workflow_node_uuid} port={port} writable={writable} refresh={refresh} />)}</section>
}
function ConfirmationRow({ job, name, port, writable, refresh }: { job: WorkflowNodeJob; name: string; port: WorkflowRecoveryPort; writable: boolean; refresh: () => Promise<void> }) {
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const inFlight = useRef(false)
  const confirmation = job.manual_confirmation!
  const [, updateDeadline] = useState(0)
  useEffect(() => {
    if (confirmation.status !== 'pending' || !confirmation.deadline_at) return
    const remaining = Date.parse(confirmation.deadline_at) - Date.now()
    if (!Number.isFinite(remaining) || remaining <= 0) return
    // 仅刷新按钮可用性，不把本地时钟解释为服务端 timed_out 终态。
    const timer = globalThis.setTimeout(() => updateDeadline((value) => value + 1), Math.min(remaining + 1, 2_147_483_647))
    return () => globalThis.clearTimeout(timer)
  }, [confirmation.status, confirmation.deadline_at])
  const decide = async (action: 'approve' | 'reject') => {
    if (inFlight.current || !confirmationActions(job, writable).includes(action)) return
    inFlight.current = true; setPending(true); setMessage('')
    try {
      await port.confirmNode(job.uuid, action)
      setMessage('决定已提交，正在核对节点状态。')
    } catch (error) {
      setMessage(`提交未确认：${error instanceof Error ? error.message : String(error)}。请核对最新状态后操作。`)
    } finally {
      try { await refresh() } catch (error) { setMessage(`节点状态刷新失败：${String(error)}`) }
      inFlight.current = false; setPending(false)
    }
  }
  const allowed = confirmationActions(job, writable && !pending)
  return <article>
    <strong>{name} · {labels[confirmation.status] || confirmation.status}</strong>
    {confirmation.deadline_at && <p>确认截止时间：<time dateTime={confirmation.deadline_at}>{new Date(confirmation.deadline_at).toLocaleString()}</time></p>}
    {confirmation.status === 'pending' && <p>批准后继续执行该节点的设备动作；拒绝将请求取消任务。</p>}
    <div className="workflow-recovery__actions">{confirmation.status === 'pending' && <>
      <button type="button" disabled={!allowed.includes('approve')} onClick={() => void decide('approve')}>批准</button>
      <button type="button" disabled={!allowed.includes('reject')} onClick={() => void decide('reject')}>拒绝</button>
    </>}<button type="button" disabled={pending} onClick={() => void refresh().catch((error: unknown) => setMessage(String(error)))}>刷新节点状态</button></div>
    {message && <p role="status">{message}</p>}
  </article>
}
