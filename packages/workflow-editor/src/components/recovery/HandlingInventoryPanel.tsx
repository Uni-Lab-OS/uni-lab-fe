import { useEffect, useState } from 'react'
import { useRecovery, useRecoveryRead } from './RecoveryContext'
import { sessionFields } from '@unilab/services'
import type { HandlingSession, ResourceOccupancy, StationSnapshot } from '@unilab/services'
type MaterialRecord = { uuid: string; sourceNodeId?: string; name: string }
import { RecoveryButton as Button } from './RecoveryButton'

export type HandlingSubmit = (path: string, body: Record<string, unknown>, label: string) => Promise<boolean>

export function HandlingInventoryPanel({ snapshot, session, writable, submit }: {
  snapshot: StationSnapshot; session: HandlingSession; writable: boolean; submit: HandlingSubmit
}) {
  const { port } = useRecovery()
  const query = useRecoveryRead(`inventory:${session.session_id}`, () => port.loadInventory(session.session_id))
  const [changes, setChanges] = useState([{ material_uuid: '', parent_uuid: '', site_uuid: '' }])
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  useEffect(() => setConfirmed(false), [query.data, snapshot.snapshot_id, writable])
  const [error, setError] = useState('')
  const instances = query.data?.instances || []
  const sites = query.data?.sites || []
  const save = async () => {
    setError('')
    if (!confirmed || !reason.trim()) return
    if (changes.some((item) => !item.material_uuid) || new Set(changes.map((item) => item.material_uuid)).size !== changes.length) {
      setError('请选择物料，同一物料在一批登记中只能出现一次。'); return
    }
    const versions: Record<string, string | number> = {}
    for (const change of changes) {
      const instance = instances.find((item) => item.edge_uuid === change.material_uuid)
      if (!instance) { setError('物料状态已变化，请刷新后重新选择。'); return }
      versions[change.material_uuid] = instance.version
      if (change.site_uuid) {
        const site = sites.find((item) => item.uuid === change.site_uuid)
        if (!site) { setError('库位状态已变化，请刷新后重新选择。'); return }
        versions[site.uuid] = site.update_time
      }
    }
    const applied = await submit(`/sessions/${session.session_id}/inventory-corrections`, {
      ...sessionFields(snapshot, session), changes, expected_inventory_versions: versions, reason: reason.trim(),
    }, '上下料登记')
    if (applied) { setChanges([{ material_uuid: '', parent_uuid: '', site_uuid: '' }]); setReason(''); setConfirmed(false) }
  }
  return <section className="handling-inventory">
    <p>完成现场上下料后，在这里登记实际位置。支持同批交换；未指定目标表示移出当前库位。</p>
    {Boolean(query.error) ? <p role="alert">库存读取失败：{query.error}</p> : null}
    <Button disabled={query.loading} onClick={() => { setConfirmed(false); void query.refresh() }}>刷新库存</Button>
    {changes.map((change, index) => <fieldset key={index} disabled={!writable || Boolean(query.error) || (!query.data || query.loading)}>
      <legend>位置登记 {index + 1}</legend>
      <label className="form-field"><span>物料</span><select aria-label={`登记物料 ${index + 1}`} value={change.material_uuid} onChange={(event) => { setConfirmed(false); setChanges((items) => items.map((item, i) => i === index ? { ...item, material_uuid: event.target.value } : item)) }}><option value="">选择物料</option>{instances.map((item) => <option key={item.edge_uuid} value={item.edge_uuid}>{item.name || item.edge_uuid}</option>)}</select></label>
      <label className="form-field"><span>目标设备或容器</span><select aria-label={`登记目标 ${index + 1}`} value={change.parent_uuid} onChange={(event) => { setConfirmed(false); setChanges((items) => items.map((item, i) => i === index ? { ...item, parent_uuid: event.target.value, site_uuid: '' } : item)) }}><option value="">移出当前库位</option>{instances.filter((item) => item.edge_uuid !== change.material_uuid).map((item) => <option key={item.edge_uuid} value={item.edge_uuid}>{item.name || item.edge_uuid}</option>)}</select></label>
      <label className="form-field"><span>目标库位</span><select aria-label={`登记库位 ${index + 1}`} disabled={!change.parent_uuid} value={change.site_uuid} onChange={(event) => { setConfirmed(false); setChanges((items) => items.map((item, i) => i === index ? { ...item, site_uuid: event.target.value } : item)) }}><option value="">不指定库位</option>{sites.filter((item) => item.material_uuid === change.parent_uuid).map((item) => <option key={item.uuid} value={item.uuid}>{item.name}{item.occupied_material_uuid ? '（已有物料）' : ''}</option>)}</select></label>
      {changes.length > 1 ? <Button onClick={() => { setConfirmed(false); setChanges((items) => items.filter((_, i) => i !== index)) }}>移除登记 {index + 1}</Button> : null}
    </fieldset>)}
    <Button disabled={!writable || changes.length >= 100} onClick={() => { setConfirmed(false); setChanges((items) => [...items, { material_uuid: '', parent_uuid: '', site_uuid: '' }]) }}>增加一项</Button>
    <label className="form-field"><span>登记原因</span><textarea value={reason} disabled={!writable} maxLength={20000} onChange={(event) => { setReason(event.target.value); setConfirmed(false) }} /></label>
    <label className="handling-check"><input type="checkbox" checked={confirmed} disabled={!writable} onChange={(event) => setConfirmed(event.target.checked)} />我已核对实际上下料情况，确认登记位置与现场一致</label>
    {error ? <p role="alert">{error}</p> : null}
    <Button tone="primary" disabled={!writable || !confirmed || !reason.trim() || Boolean(query.error) || (!query.data || query.loading)} onClick={() => { void save() }}>保存上下料登记</Button>
  </section>
}

export function HandlingOccupanciesPanel({ snapshot, session, materials, writable, submit }: {
  snapshot: StationSnapshot; session: HandlingSession; materials: MaterialRecord[]; writable: boolean; submit: HandlingSubmit
}) {
  const { port } = useRecovery()
  const query = useRecoveryRead(`occupancies:${session.session_id}`, () => port.loadOccupancies())
  const [selected, setSelected] = useState<ResourceOccupancy[]>([])
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  useEffect(() => setConfirmed(false), [query.data, snapshot.snapshot_id, writable])
  const release = async () => {
    const applied = await submit('/resource-dispositions', {
      ...sessionFields(snapshot, session), decision_id: session.decision_id, session_id: session.session_id,
      occupancy_ids: selected.map((item) => item.uuid), expected_versions: Object.fromEntries(selected.map((item) => [item.uuid, item.version])),
      operation: 'release', reason: reason.trim(),
    }, '释放逻辑占用')
    if (applied) { setSelected([]); setConfirmed(false); setReason('') }
  }
  return <section>
    <p>选择要释放的逻辑占用。设备是否已停止、现场是否允许恢复，由你核对。</p>
    <Button disabled={query.loading} onClick={() => { setSelected([]); setConfirmed(false); void query.refresh() }}>刷新逻辑占用</Button>
    {Boolean(query.error) ? <p role="alert">逻辑占用读取失败：{query.error}</p> : null}
    <div className="handling-occupancies">{query.data?.map((item) => <label key={item.uuid}>
      <input type="checkbox" disabled={!writable || query.loading || Boolean(query.error)} checked={selected.some((entry) => entry.uuid === item.uuid)} onChange={(event) => { setConfirmed(false); setSelected((items) => event.target.checked ? [...items, item] : items.filter((entry) => entry.uuid !== item.uuid)) }} />
      <span><strong>{materials.find((material) => material.uuid === item.material_uuid || material.sourceNodeId === item.device_id)?.name || item.lock_key}</strong><small>{item.occupancy_kind === 'device_tenancy' ? '设备占用' : '执行占用'} · {item.state}</small><code>Task {item.workflow_task_uuid || item.task_uuid || '—'}</code><code>{item.lock_key}</code></span>
    </label>)}</div>
    {Boolean(query.data) && !query.data?.length ? <p>当前没有逻辑占用。</p> : null}
    <label className="form-field"><span>释放原因</span><textarea value={reason} disabled={!writable} maxLength={20000} onChange={(event) => { setReason(event.target.value); setConfirmed(false) }} /></label>
    <label className="handling-check"><input type="checkbox" checked={confirmed} disabled={!writable} onChange={(event) => setConfirmed(event.target.checked)} />我已核对现场，确认所选逻辑占用可以释放</label>
    <Button tone="danger" disabled={!writable || !selected.length || !confirmed || !reason.trim() || Boolean(query.error) || query.loading} onClick={() => { void release() }}>释放所选逻辑占用</Button>
  </section>
}
