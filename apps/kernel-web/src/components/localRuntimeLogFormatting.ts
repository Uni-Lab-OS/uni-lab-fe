/**
 * 兼容 Kernel Web 既有导入路径，实际格式化规则由设计系统共享工具维护。
 */
export {
  detectPhoenixObservabilityDependencyIssue,
  formatLocalRuntimeLog,
  prepareLocalRuntimeLogCopyText
} from '@unilab/design-system/lib/runtime-log-formatting'
export type {
  FormattedLocalRuntimeLogRow,
  LocalRuntimeLogLevel
} from '@unilab/design-system/lib/runtime-log-formatting'
