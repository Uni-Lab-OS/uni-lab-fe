const ERROR_CODE = /^\[([^\]]+)]\s*/

/**
 * 把 Workspace Host 的诊断信息转换成面向用户的问题说明。
 * 内部错误码、接口路径和底层网络异常只进入日志，不出现在操作提示中。
 */
export function workbenchUserErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const code = raw.match(ERROR_CODE)?.[1] ?? ''

  if (/unsupported task status/i.test(raw)) {
    return '目标 Backend 版本与当前工作台不兼容。请升级 Backend 后重试。'
  }

  if (code === 'backend_authority_unavailable') {
    return '目标 Backend 或 Scheduler 未启动，或当前无法访问。请确认服务已启动后重试。'
  }
  if (code === 'backend_authority_incompatible') {
    return '目标 Scheduler 版本不支持当前连接方式，请升级或启动兼容版本后重试。'
  }
  if (code === 'authority_task_state_unavailable') {
    return '暂时无法确认当前任务状态。为避免影响正在运行的任务，本次切换已取消，请稍后重试。'
  }
  if (code === 'authority_tasks_active') {
    return '当前环境存在活动任务。你可以先取消任务，再继续切换。'
  }
  if (code === 'release_target_busy') {
    return '目标 Backend 存在活动任务。你可以先取消任务，再继续切换。'
  }
  if (code === 'task_cancel_unavailable') {
    return '暂时无法读取活动任务，未执行切换。请检查当前环境连接后重试。'
  }
  if (code === 'task_cancel_failed') {
    return '部分任务未能取消，未执行切换。请在任务列表中处理后重试。'
  }
  if (code === 'task_cancel_timeout') {
    return '任务仍在取消中，未执行切换。请稍后重试。'
  }

  return raw
    .replace(ERROR_CODE, '')
    .replaceAll('运行权威', '运行环境')
    .replaceAll('Authority', '运行环境')
    .replace(/：?\/?api\/v\d+\/[^：；\s]+/g, '')
    .replace(/：?<urlopen error[^>]*>/gi, '')
    .trim()
}
