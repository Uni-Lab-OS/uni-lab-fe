import {
  onMounted,
  onUnmounted,
  reactive,
  ref
} from 'vue'

import { getDeviceCardBridge } from './bridge'
import type {
  DeviceCardActionRun,
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
    saveConfig: (patch) => bridge.saveConfig(patch)
  }
}
