/**
 * ============================================================
 * AI-GENERATED CODE METADATA
 * ============================================================
 * Model: Claude Opus 4.8
 * Generation Date: 2026-07-22
 * Prompt Summary: 定义调试客户端三大方向(设备/物料/工作流)与后端交互的核心数据模型
 * Context: 对接 Uni-Lab-OS localhost:8002 REST/WS,支持离线/在线双模
 * Human Review Status: [ ] Pending  [ ] Reviewed  [ ] Approved
 * ============================================================
 */

// 三大工作方向
export type WorkbenchSection =
  | 'device'
  | 'device-square'
  | 'material'
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
