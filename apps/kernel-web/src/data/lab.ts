/**
 * ============================================================
 * AI-GENERATED CODE METADATA
 * ============================================================
 * Model: Claude Opus 4.8
 * Generation Date: 2026-07-22
 * Prompt Summary: 定义调试客户端一级模块与后端交互的核心数据模型
 * Context: 对接 Uni-Lab-OS localhost:8002 REST/WS,支持离线/在线双模
 * Human Review Status: [ ] Pending  [ ] Reviewed  [ ] Approved
 * ============================================================
 */

// 应用一级工作模块；试剂与物料保持独立导航身份。
export type WorkbenchSection =
  | 'device'
  | 'device-square'
  | 'cards'
  | 'material'
  | 'reagent'
  | 'scene'
  | 'workflow'

// 后端连接状态
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export type {
  DeviceAction,
  DeviceActionTarget,
  DeviceStatus,
  ResourceNode
} from '@unilab/services'
