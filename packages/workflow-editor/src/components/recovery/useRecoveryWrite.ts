import { useRef, useState } from 'react'
import { recoveryRequestDefinitive } from '@unilab/services'
import { useRecovery } from './RecoveryContext'
export interface RecoveryWriteIntent { key: string; body: Record<string, unknown> }
/** 持久化一次明确的用户操作；只允许重放同一请求，不自动重试设备操作。 */
export function useRecoveryWrite(identity: string, execute: (intent: RecoveryWriteIntent) => Promise<boolean>, refresh: () => Promise<void>) {
  const { port } = useRecovery()
  const storageKey = `unilab:workbench:recovery:${port.scopeKey}:${identity}`
  const [intent, setIntent] = useState<RecoveryWriteIntent | null>(() => {
    try { const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); return saved?.key && saved.body && typeof saved.body === 'object' ? saved : null } catch { return null }
  })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const submit = async (body?: Record<string, unknown>) => {
    if (busy.current || (!intent && !body)) return
    const request = intent || { key: crypto.randomUUID(), body: body! }
    busy.current = true; setPending(true); setError('')
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(request)); setIntent(request)
    } catch { setError('无法保存请求身份，操作未提交。'); busy.current = false; setPending(false); return }
    try {
      if (await execute(request)) { sessionStorage.removeItem(storageKey); setIntent(null) }
      else setError('操作已受理，等待生效。可以继续确认原请求。')
    } catch (cause) {
      if (recoveryRequestDefinitive(cause)) { sessionStorage.removeItem(storageKey); setIntent(null) }
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      try { await refresh() } catch (cause) { setError(`刷新状态失败：${String(cause)}`) }
      busy.current = false; setPending(false)
    }
  }
  return { intent, pending, error, submit }
}
