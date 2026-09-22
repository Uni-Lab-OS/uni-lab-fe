export function shortIdentifier(value: string): string {
  return value.length > 16
    ? `${value.slice(0, 8)}…${value.slice(-6)}`
    : value
}

export interface DeviceDispatchBlockPresentation {
  label: string
  detail: string
}

/**
 * 将 Authority 提供的派发阻断原因转换为稳定、可行动的用户文案。
 * 未识别的 wire 原因不直接暴露给界面。
 */
export function deviceDispatchBlockPresentation(
  reason: string | null
): DeviceDispatchBlockPresentation {
  if (reason?.startsWith('unresolved_unknown_command:')) {
    return {
      label: '历史命令待核验',
      detail: '存在未确认的历史命令；完成安全核验后才能恢复派发'
    }
  }
  if (reason) {
    return {
      label: '安全策略限制',
      detail: '当前被安全策略阻止派发；完成设备核验后再试'
    }
  }
  return {
    label: '调度原因未上报',
    detail: 'Authority 未提供受限原因；请刷新设备目录，仍未恢复时检查 Edge 状态'
  }
}
