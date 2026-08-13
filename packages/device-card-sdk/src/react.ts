import {
  useCallback,
  useEffect,
  useState
} from 'react'

import { getDeviceCardBridge } from './bridge'
import type {
  DeviceCardActionRun,
  DeviceCardJointPreviewFrame,
  DeviceCardRuntimeSnapshot,
  JsonObject
} from './contracts'

export function useDeviceCard(options: {
  state: readonly string[]
}): {
  state: Record<string, unknown>
  ready: boolean
  context: DeviceCardRuntimeSnapshot | null
  callAction: (
    action: string,
    params?: Record<string, unknown>
  ) => Promise<DeviceCardActionRun>
  saveConfig: (patch: JsonObject) => Promise<JsonObject>
  setJointPreview: (
    jointStates: Readonly<Record<string, number>>
  ) => Promise<DeviceCardJointPreviewFrame>
} {
  const [state, setState] = useState<Record<string, unknown>>({})
  const [context, setContext] =
    useState<DeviceCardRuntimeSnapshot | null>(null)
  const [ready, setReady] = useState(false)
  const stateKey = options.state.join('\u0000')

  useEffect(() => {
    const bridge = getDeviceCardBridge()
    let active = true
    let unsubscribe: (() => void) | null = null
    void bridge.getContext().then((snapshot) => {
      if (!active) return
      setContext(snapshot)
      setState(snapshot.state)
      const stateKeys = stateKey.length > 0 ? stateKey.split('\u0000') : []
      unsubscribe = bridge.subscribeState(stateKeys, (nextState) => {
        if (active) setState(nextState)
      })
      setReady(true)
    })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [stateKey])

  const callAction = useCallback((
    action: string,
    params?: Record<string, unknown>
  ): Promise<DeviceCardActionRun> => {
    return getDeviceCardBridge().callAction(action, params)
  }, [])

  const saveConfig = useCallback((patch: JsonObject): Promise<JsonObject> => {
    return getDeviceCardBridge().saveConfig(patch)
  }, [])

  const setJointPreview = useCallback((
    jointStates: Readonly<Record<string, number>>
  ): Promise<DeviceCardJointPreviewFrame> => {
    const bridge = getDeviceCardBridge()
    if (!bridge.setJointPreview) {
      return Promise.reject(new Error(
        '当前 Device Card Host 不支持关节模型预览，请升级 Uni-Lab。'
      ))
    }
    return bridge.setJointPreview(jointStates)
  }, [])

  return { state, ready, context, callAction, saveConfig, setJointPreview }
}
