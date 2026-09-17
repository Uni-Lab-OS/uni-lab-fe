import type { WorkflowAuthoringDiagnostic } from '@unilab/services'

/** 常见参数键的中文叫法，避免直接把英文变量名甩给实验人员。 */
const PARAMETER_LABELS: Record<string, string> = {
  beaker: '烧杯',
  sample: '样品',
  material: '物料',
  resource: '资源',
  site: '库位',
  warehouse: '仓库',
  position: '位置',
  sample_id: '样品编号'
}

/** 诊断码对应的短标题（给草稿诊断列表用）。 */
const DIAGNOSTIC_TITLES: Record<string, string> = {
  candidate_invalid: '流程还不完整',
  required_action_parameter_missing: '还有必填项未填写',
  template_catalog_mismatch: '操作定义已更新',
  template_catalog_conflict: '操作目录已更新',
  round_trip_mismatch: '画布与源码不一致',
  composite_child_not_experiment_operation: '不能嵌套该类型流程',
  composite_catalog_mismatch: '子流程定义不匹配',
  invalid_node_metadata: '节点展示信息不合法'
}

/**
 * 把参数键转成用户可读名称。
 *
 * @param key 动作参数或连接点业务名。
 */
export function authoringParameterLabel(key: string): string {
  const normalized = key.trim()
  if (!normalized) return '参数'
  return PARAMETER_LABELS[normalized] ?? normalized
}

/**
 * 把 OS / 本地草稿诊断整理成面向实验人员的标题与说明。
 *
 * @param diagnostic 含 code/message 的诊断项。
 */
export function formatAuthoringDiagnostic(diagnostic: {
  code: string
  message: string
}): { title: string; detail: string } {
  const code = diagnostic.code.trim()
  const rawMessage = diagnostic.message.trim()
  const title = /物料来源资源模板 UUID 不能反解|资源模板源码身份不能安全/u.test(rawMessage)
    ? '物料来源模板不可用'
    : DIAGNOSTIC_TITLES[code] ?? '需要处理的问题'
  return {
    title,
    detail: humanizeAuthoringMessage(rawMessage, code)
  }
}

/**
 * 把抛错文案（常含 ``code: message``）整理成单行用户可读说明。
 *
 * @param value Error.message 或任意原始字符串。
 */
export function formatAuthoringError(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return '当前操作没有完成，请检查后重试。'
  const matched = /^([a-z0-9_]+)\s*:\s*(.+)$/i.exec(trimmed)
  if (matched) {
    const [, code, message] = matched
    return humanizeAuthoringMessage(message, code)
  }
  return humanizeAuthoringMessage(trimmed)
}

/** 根据已知模式把技术消息翻成操作指引。 */
function humanizeAuthoringMessage(message: string, code = ''): string {
  // Hide the backend implementation detail while retaining the actionable cause.
  message = message.replace(
    /^候选(?:图|结果)不能通过公共工作流校验[：:]?\s*/u,
    ''
  )
  const missingRequired = /^动作缺少必填参数\s+(.+)$/u.exec(message)
    || /^缺少必填输入\s+['"]?(.+?)['"]?$/u.exec(message)
  if (missingRequired) {
    const label = authoringParameterLabel(
      (missingRequired[1] ?? '').replace(/^['"]|['"]$/g, '')
    )
    return `还需要配置「${label}」：请连接上游物料，或在右侧参数面板中填写。草稿可以先保存，配齐后才能运行。`
  }
  if (code === 'required_action_parameter_missing' || /为必填参数$/u.test(message)) {
    const label = message.replace(/为必填参数$/u, '').trim() || '该项'
    return `「${label}」还是必填的：请连接上游物料，或在参数面板中填写。草稿可以先保存，配齐后才能运行。`
  }
  if (/物料来源资源模板 UUID 不能反解|资源模板源码身份不能安全/u.test(message)) {
    return '物料来源选择的资源模板没有可用的源码定义。请在物料来源参数中改选受支持的物料模板，并选择兼容挂载点。'
  }
  if (code === 'template_catalog_mismatch' || /目录语义已漂移|模板目录/u.test(message)) {
    return '设备操作定义有更新，当前草稿里的节点已对不上。请删掉受影响节点后，从左侧操作库重新拖入。'
  }
  if (code === 'template_catalog_conflict') {
    return '操作目录刚刷新过。请重新打开该工作流，或删掉旧节点后重新添加。'
  }
  if (code === 'round_trip_mismatch' || /语义等价/u.test(message)) {
    return '画布内容和生成的流程源码对不上。请检查节点参数后重新保存；若仍不行，可删掉问题节点再添加一次。'
  }
  if (code === 'composite_child_not_experiment_operation') {
    return '实验操作里不能直接嵌套这类流程。请改用设备动作，或选择允许调用的实验操作。'
  }
  if (/候选图无法生成可信作者源码/u.test(message)) {
    return '当前画布还不能生成完整流程。请检查节点参数和连线是否齐全。'
  }
  if (/自定义节点展示必须包含描述/u.test(message)) {
    return '自定义节点名称可以只改标题；若仍报错，请刷新页面后再试。'
  }
  return message
}

/** 草稿诊断列表展示用：优先友好文案，不直接甩技术错误码。 */
export function authoringDiagnosticSummary(
  diagnostic: Pick<WorkflowAuthoringDiagnostic, 'code' | 'message'>
): string {
  const { title, detail } = formatAuthoringDiagnostic(diagnostic)
  return `${title}：${detail}`
}
