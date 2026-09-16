import { useCallback, useEffect, useRef, useState } from 'react'
import type { Services } from '@unilab/services'
import type { ManagedDevice } from './deviceCatalog'
import { loadDeviceTaskLocks, type DeviceTaskLockSnapshot } from './deviceTaskLocks'

/** 锁快照属于当前服务；错误和切换时未知，不能显示为零台锁定。 */
export function useDeviceTaskLocks(
  services: Services,
  enabled: boolean,
  devices: readonly ManagedDevice[]
) {
  const [snapshot, setSnapshot] = useState<DeviceTaskLockSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const source = useRef<{ services: Services; devices: readonly ManagedDevice[] } | null>(null)
  const generation = useRef(0)
  const pending = useRef<Promise<void> | null>(null)
  const queued = useRef(false)
  const supported = enabled && services.capabilities.workflow.releaseTaskResources
    && Boolean(services.workflow.executionLocks)

  const refresh = useCallback((): Promise<void> => {
    if (!supported) return Promise.resolve()
    if (pending.current) {
      queued.current = true
      return pending.current
    }
    const request = ++generation.current
    setLoading(true)
    setError(null)
    const operation = loadDeviceTaskLocks(
      services.workflow,
      new Set(devices.map(device => device.materialUuid))
    ).then(result => {
      if (generation.current === request) {
        source.current = { services, devices }
        setSnapshot(result)
      }
    }).catch(failure => {
      if (generation.current === request) {
        setSnapshot(null)
        setError(failure instanceof Error ? failure.message : '读取任务锁失败')
      }
    }).finally(() => {
      if (generation.current !== request) return
      pending.current = null
      setLoading(false)
      if (queued.current) {
        queued.current = false
        void refresh()
      }
    })
    pending.current = operation
    return operation
  }, [supported, services, devices])

  useEffect(() => {
    setSnapshot(null)
    setError(null)
    setLoading(false)
    void refresh()
    if (!supported) return
    const subscription = services.workflow.subscribeWorkflowRuntime(event => {
      if (event.event === 'workflow.runtime.changed' || event.event === 'device_action_task.changed') {
        void refresh()
      }
    }, {
      onOpen: state => { if (state.reconnected) void refresh() }
    })
    return () => {
      generation.current += 1
      pending.current = null
      queued.current = false
      subscription.dispose()
    }
  }, [refresh, services, supported])

  const current = supported && source.current?.services === services
    && source.current.devices === devices ? snapshot : null

  return {
    snapshot: current,
    owners: current?.owners ?? [],
    lockedDeviceIds: current?.lockedDeviceIds ?? new Set<string>(),
    known: current?.known === true && !loading,
    loading,
    error,
    refresh
  }
}
