import { useState } from 'react'
import { sessionFields, type HandlingSession, type StationSnapshot } from '@unilab/services'
import { HandlingInventoryPanel, HandlingOccupanciesPanel } from './HandlingInventoryPanel'
import { ManualRecoveryActions, ManualActionHistory } from './ManualRecoveryActions'
import type { RecoverySubmit } from './StationRecovery'
export function ManualRecovery({ snapshot, session, writable, submit }: { snapshot: StationSnapshot; session: HandlingSession; writable: boolean; submit: RecoverySubmit }) {
  const [tab, setTab] = useState('actions')
  const [summary, setSummary] = useState(session.summary || '')
  const jobs = snapshot.manual_actions.filter((job) => job.meta_data.session_id === session.session_id)
  const running = jobs.filter((job) => !['succeeded', 'failed', 'timeout', 'canceled'].includes(job.status)).length
  const unresolved = jobs.filter((job) => ['succeeded', 'failed', 'timeout', 'canceled'].includes(job.status) && job.uncertainty_reason && !job.result_reviewed).length
  return <section>
    <p>人工处置期间普通调度保持暂停。设备动作绕过逻辑锁条件，请先核对现场。</p>
    <nav className="workflow-recovery__actions" aria-label="人工处置操作">{[['actions', '设备单点动作'], ['inventory', '上下料登记'], ['occupancies', '逻辑占用']].map(([id, label]) => <button type="button" key={id} aria-pressed={id === tab} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {tab === 'actions' ? <><ManualRecoveryActions snapshot={snapshot} session={session} writable={writable} submit={submit} /><ManualActionHistory snapshot={snapshot} session={session} writable={writable} submit={submit} /></>
      : tab === 'inventory' ? <HandlingInventoryPanel snapshot={snapshot} session={session} writable={writable} submit={submit} />
        : <HandlingOccupanciesPanel snapshot={snapshot} session={session} writable={writable} submit={submit} materials={[]} />}
    <label>现场处理说明<textarea maxLength={20000} value={summary} disabled={!writable} onChange={(event) => setSummary(event.target.value)} /></label>
    <p>{running} 个动作未结束，{unresolved} 个结果待核对。</p>
    <button type="button" disabled={!writable || running > 0 || unresolved > 0} onClick={() => void submit(`/sessions/${encodeURIComponent(session.session_id)}/complete`, { ...sessionFields(snapshot, session), summary }, '完成人工处置')}>处理完成，返回重试／取消选择</button>
  </section>
}
