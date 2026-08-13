import {
  onMounted,
  onUnmounted,
  reactive,
  ref
} from 'vue'

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
  state: Readonly<Record<string, unknown>>
  ready: Readonly<{ value: boolean }>
  context: Readonly<{ value: DeviceCardRuntimeSnapshot | null }>
  callAction: (
    action: string,
    params?: Record<string, unknown>
  ) => Promise<DeviceCardActionRun>
  saveConfig: (patch: JsonObject) => Promise<JsonObject>
  setJointPreview: (
    jointStates: Readonly<Record<string, number>>
  ) => Promise<DeviceCardJointPreviewFrame>
} {
  const bridge = getDeviceCardBridge()
  const state = reactive<Record<string, unknown>>({})
  const ready = ref(false)
  const context = ref<DeviceCardRuntimeSnapshot | null>(null)
  let unsubscribe: (() => void) | null = null

  onMounted(async () => {
    const snapshot = await bridge.getContext()
    context.value = snapshot
    Object.assign(state, snapshot.state)
    unsubscribe = bridge.subscribeState(options.state, (nextState) => {
      for (const key of Object.keys(state)) {
        if (!(key in nextState)) delete state[key]
      }
      Object.assign(state, nextState)
    })
    ready.value = true
  })

  onUnmounted(() => {
    unsubscribe?.()
    unsubscribe = null
  })

  return {
    state,
    ready,
    context,
    callAction: (action, params) => bridge.callAction(action, params),
    saveConfig: (patch) => bridge.saveConfig(patch),
    setJointPreview: (jointStates) => {
      if (!bridge.setJointPreview) {
        return Promise.reject(new Error(
          '当前 Device Card Host 不支持关节模型预览，请升级 Uni-Lab。'
        ))
      }
      return bridge.setJointPreview(jointStates)
    }
  }
}
