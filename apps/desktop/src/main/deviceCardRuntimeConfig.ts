import type { DeviceCardManifest, JsonObject } from '@unilab/device-card-sdk'

/** 把 Host 收窄后的 manifest 权限合并进卡片运行时 config。 */
export function buildDeviceCardRuntimeConfig(manifest: DeviceCardManifest): JsonObject {
  return {
    ...(manifest.config?.defaults ?? {}),
    allowedActions: [...manifest.permissions.actions],
    allowedState: [...manifest.permissions.state]
  }
}
