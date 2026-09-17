import {
  handlingErrorMessage, recoveryRequestDefinitive,
  type HandlingIntent, type StationSnapshot, type WorkflowRecoveryPort
} from '@unilab/services'

export interface RecoveryState {
  station?: StationSnapshot
  readError?: string
  error?: string
  pending: boolean
  unconfirmed: HandlingIntent | null
  revision: number
}

/** 只保存请求身份，运行事实始终由 REST 补读；SSE 只触发失效。 */
export class WorkflowRecoveryController {
  private state: RecoveryState = { pending: false, unconfirmed: null, revision: 0 }
  private listeners = new Set<() => void>()
  private subscription?: { dispose(): void }
  private consumers = 0
  private pollTimer?: ReturnType<typeof setTimeout>
  private reconcileTimer?: ReturnType<typeof setInterval>
  private onFocus = () => { void this.refresh() }
  private forceRevision = false
  private reading = false
  private dirty = false
  private disposedGeneration = 0
  readonly storageKey: string
  constructor(readonly port: WorkflowRecoveryPort, private storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
    this.storageKey = `unilab:workbench:station-intent:${port.scopeKey}`
    try {
      const value = JSON.parse(storage?.getItem(this.storageKey) || 'null') as HandlingIntent | null
      if (value && typeof value.path === 'string' && typeof value.key === 'string' && value.key && typeof value.label === 'string' && value.body && !Array.isArray(value.body)) this.state.unconfirmed = value
    } catch { /* 损坏的请求不恢复，也不会自动提交。 */ }
  }
  getSnapshot = (): RecoveryState => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private update(patch: Partial<RecoveryState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener()) }
  retain = (): (() => void) => {
    this.consumers++
    if (this.consumers === 1) {
      this.update({ readError: '正在核对工站状态，请稍候' })
      this.subscription = this.port.subscribe(() => { void this.refresh() }, (error) => this.update({ readError: error.message }))
      if (typeof window !== 'undefined') window.addEventListener('focus', this.onFocus)
      this.reconcileTimer = setInterval(() => { void this.refresh() }, 30_000)
      void this.refresh()
    }
    return () => {
      this.consumers--
      if (!this.consumers) {
        this.subscription?.dispose(); this.subscription = undefined; this.disposedGeneration++; this.dirty = false; this.forceRevision = false
        clearTimeout(this.pollTimer); clearInterval(this.reconcileTimer)
        if (typeof window !== 'undefined') window.removeEventListener('focus', this.onFocus)
      }
    }
  }
  refresh = async (forceRevision = true): Promise<void> => {
    clearTimeout(this.pollTimer)
    this.forceRevision ||= forceRevision
    this.dirty = true
    if (this.reading) return
    this.reading = true
    try {
      do {
        this.dirty = false
        const force = this.forceRevision; this.forceRevision = false
        const generation = this.disposedGeneration
        try {
          const station = await this.port.loadStation()
          if (generation !== this.disposedGeneration) { this.dirty = this.consumers > 0; continue }
          // 不变的轮询快照保留对象身份，避免清空填写中的现场确认。
          const changed = JSON.stringify(station, (key, value) => key === 'event_cursor' ? undefined : value) !== JSON.stringify(this.state.station, (key, value) => key === 'event_cursor' ? undefined : value)
          this.update({ station: changed ? station : this.state.station, readError: undefined,
            revision: this.state.revision + (changed || force || this.state.readError ? 1 : 0) })
        } catch (error) {
          if (generation === this.disposedGeneration) this.update({ readError: error instanceof Error ? error.message : String(error) })
        }
      } while (this.dirty)
    } finally {
      this.reading = false
      if (this.consumers) this.pollTimer = setTimeout(() => { void this.refresh(false) }, this.state.station?.mode === 'PAUSED' ? 1500 : 5000)
    }
  }
  submit = async (path: string, body: Record<string, unknown>, label: string): Promise<boolean> => {
    if (this.state.unconfirmed || this.state.pending || this.state.readError || !this.state.station) return false
    return this.execute({ path, body, label, key: crypto.randomUUID() })
  }
  retry = async (): Promise<boolean> => this.state.unconfirmed ? this.execute(this.state.unconfirmed) : false
  private async execute(intent: HandlingIntent): Promise<boolean> {
    if (this.state.pending || this.state.readError) return false
    this.update({ pending: true, error: undefined })
    try {
      if (!this.storage) throw new Error('会话存储不可用，无法安全保存请求身份')
      this.storage.setItem(this.storageKey, JSON.stringify(intent))
    } catch (error) {
      this.update({ pending: false, error: String(error) }); return false
    }
    this.update({ unconfirmed: intent })
    try {
      const result = await this.port.submit(intent)
      this.storage.removeItem(this.storageKey)
      this.update({ unconfirmed: null, error: result.status === 'FAILED'
        ? result.result.error || '操作被拒绝，请核对最新状态'
        : result.status === 'PENDING' || result.application_error || result.dispatch_error
          ? `操作已受理，等待应用。${result.application_error || result.dispatch_error || ''}` : undefined })
      await this.refresh()
      return result.status === 'APPLIED' && !result.application_error && !result.dispatch_error
    } catch (error) {
      if (recoveryRequestDefinitive(error)) {
        this.storage.removeItem(this.storageKey)
        this.update({ unconfirmed: null, error: handlingErrorMessage(error) })
        await this.refresh()
      } else this.update({ error: '提交结果待确认。请按原请求继续确认，避免重复执行。' })
      return false
    } finally { this.update({ pending: false }) }
  }
}
