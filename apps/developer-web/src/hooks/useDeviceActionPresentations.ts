import type { DeviceActionPresentations } from '@unilab-fe/core'
import { useBackend } from '../app/BackendProvider'
import { useBackendQuery } from './useBackendQuery'

export interface DeviceActionPresentationsState {
  /** profile 未声明能力或读取失败时为 undefined，页面回退到 OS Schema 展示。 */
  readonly presentations: DeviceActionPresentations | undefined
  readonly available: boolean
  readonly error: Error | undefined
}

/** 设备动作展示元数据；只在 profile 声明 deviceAction.presentation 时请求，不试探后端。 */
export function useDeviceActionPresentations(): DeviceActionPresentationsState {
  const { backend } = useBackend()
  const available = backend.getCapabilityStatus('deviceAction.presentation').available
  const query = useBackendQuery('device-action-presentations', (current) =>
    available
      ? current.core.deviceActionPresentations.getActionPresentations()
      : Promise.resolve(undefined),
  )
  return {
    presentations: available ? query.data : undefined,
    available,
    error: available ? query.error : undefined,
  }
}
