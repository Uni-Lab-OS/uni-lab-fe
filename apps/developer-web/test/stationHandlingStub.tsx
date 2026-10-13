import { vi } from 'vitest'
import type { ReactNode } from 'react'
import type {
  StationCommandOptions,
  StationCommandReceipt,
  StationDecisionRequest,
  StationErrorFact,
  StationHandlingInventory,
  StationHandlingSnapshot,
  StationInventoryCorrectionRequest,
  StationManualActionJob,
  StationManualActionRequest,
  StationManualDeviceAction,
  StationManualReviewContext,
  StationManualReviewRequest,
  StationSessionManualReviewRequest,
  StationOccupancyReleaseRequest,
  StationResourceOccupancy,
  StationResumeRequest,
  StationSessionCompleteRequest,
} from '@unilab-fe/core'
import { BackendProvider } from '../src/app/BackendProvider'
import { StationHandlingProvider } from '../src/features/station-handling/StationHandlingProvider'

/** 测试用的工站快照。默认是「工站正常运行、没有错误事实」这个安静状态。 */
export function makeStationSnapshot(
  overrides: Partial<StationHandlingSnapshot> = {},
): StationHandlingSnapshot {
  return {
    kind: 'station_handling_snapshot',
    source: 'os',
    stationId: 'local',
    mode: 'RUNNING',
    stationVersion: 1,
    errorEpoch: 0,
    snapshotId: 'local:1:0',
    activeSessionId: null,
    activeSession: null,
    errors: [],
    manualActions: [],
    controlCommands: [],
    raw: {},
    ...overrides,
  }
}

export function makeStationError(overrides: Partial<StationErrorFact> = {}): StationErrorFact {
  return {
    kind: 'station_error_fact',
    source: 'os',
    decisionId: 'decision-1',
    decisionVersion: 2,
    stage: 'DECISION_REQUIRED',
    status: 'open',
    // 默认与 OS 的 OPTIONS 一致；用例可以覆盖成空数组表示 OS 没有声明选项。
    options: [
      { id: 'cancel_task', label: '取消当前任务' },
      { id: 'retry_current_node', label: '重试当前节点' },
      { id: 'enter_manual_handling', label: '进入手动处理' },
    ],
    sessionId: null,
    sourceTaskUuid: 'task-1',
    sourceJobUuid: 'job-1',
    message: 'SZLAB_TEST_NODE_FAILURE：预期的节点测试错误',
    sourceNodeId: null,
    errorPhase: 'execution',
    openedAt: '2026-01-01T00:00:00Z',
    raw: {},
    ...overrides,
  }
}

export function makeManualActionJob(
  overrides: Partial<StationManualActionJob> = {},
): StationManualActionJob {
  return {
    kind: 'station_manual_action_job',
    source: 'os',
    jobUuid: 'job-1',
    sessionId: 'session-1',
    status: 'failed',
    deviceId: 'S06 机械臂',
    actionName: '夹爪闭合',
    edgeCommandUuid: 'edge-1',
    uncertaintyReason: null,
    resultReviewed: false,
    reviewVersion: 'review-v1',
    startedAt: null,
    finishedAt: null,
    raw: {},
    ...overrides,
  }
}

export function makeManualReviewContext(
  overrides: Partial<StationManualReviewContext> = {},
): StationManualReviewContext {
  return {
    kind: 'station_manual_review_context',
    source: 'os',
    stationId: 'local',
    sessionId: 'session-1',
    sessionStage: 'DECISION_REQUIRED',
    job: makeManualActionJob(),
    reviewVersion: 'review-v1',
    resultReviewed: false,
    audit: null,
    raw: {},
    ...overrides,
  }
}

export function makeStationReceipt(
  overrides: Partial<StationCommandReceipt> = {},
): StationCommandReceipt {
  return {
    kind: 'station_command_receipt',
    source: 'os',
    commandUuid: 'command-1',
    operation: 'retry_current_node',
    status: 'APPLIED',
    snapshot: null,
    applicationError: null,
    dispatchError: null,
    raw: {},
    ...overrides,
  }
}

/** 只暴露被测组件真正读取的字段；不模拟真实 HTTP 语义。 */
export function createStationPortStub(snapshot: StationHandlingSnapshot = makeStationSnapshot()) {
  return {
    getSnapshot: vi.fn(async (_signal?: AbortSignal) => snapshot),
    // 参数必须显式声明：否则 mock.calls 的元组是空的，断言请求字段时拿不到类型。
    decide: vi.fn(
      async (
        _decisionId: string,
        _request: StationDecisionRequest,
        _options: StationCommandOptions,
      ) => makeStationReceipt(),
    ),
    resume: vi.fn(async (_request: StationResumeRequest, _options: StationCommandOptions) =>
      makeStationReceipt({ operation: 'resume' }),
    ),
    applyControlCommand: vi.fn(async (_commandUuid: string) =>
      makeStationReceipt({ operation: 'apply' }),
    ),
    completeSession: vi.fn(
      async (
        _sessionId: string,
        _request: StationSessionCompleteRequest,
        _options: StationCommandOptions,
      ) => makeStationReceipt({ operation: 'complete-session' }),
    ),
    // 人工处置：默认给空目录/空库存，单个用例要什么自己 mockResolvedValue。
    listManualDeviceActions: vi.fn(
      async (_sessionId: string, _deviceId: string, _signal?: AbortSignal) =>
        [] as readonly StationManualDeviceAction[],
    ),
    executeManualAction: vi.fn(
      async (
        _sessionId: string,
        _request: StationManualActionRequest,
        _options: StationCommandOptions,
      ) => makeStationReceipt(),
    ),
    stopManualAction: vi.fn(
      async (_commandUuid: string, _reason: string, _options: StationCommandOptions) =>
        makeStationReceipt(),
    ),
    getHandlingInventory: vi.fn(
      async (_sessionId: string, _signal?: AbortSignal) =>
        ({
          kind: 'station_handling_inventory',
          source: 'os',
          instances: [],
          sites: [],
          raw: {},
        }) as StationHandlingInventory,
    ),
    correctInventory: vi.fn(
      async (
        _sessionId: string,
        _request: StationInventoryCorrectionRequest,
        _options: StationCommandOptions,
      ) => makeStationReceipt(),
    ),
    listResourceOccupancies: vi.fn(
      async (_signal?: AbortSignal) => [] as readonly StationResourceOccupancy[],
    ),
    releaseOccupancies: vi.fn(
      async (_request: StationOccupancyReleaseRequest, _options: StationCommandOptions) =>
        makeStationReceipt(),
    ),
    reviewSessionManualAction: vi.fn(
      async (
        _commandUuid: string,
        _request: StationSessionManualReviewRequest,
        _options: StationCommandOptions,
      ) => makeStationReceipt(),
    ),
    getManualActionReview: vi.fn(async (_jobUuid: string, _signal?: AbortSignal) =>
      makeManualReviewContext(),
    ),
    submitManualActionReview: vi.fn(
      async (
        _jobUuid: string,
        _request: StationManualReviewRequest,
        _options: StationCommandOptions,
      ) => makeStationReceipt(),
    ),
    returnSession: vi.fn(
      async (
        _sessionId: string,
        _request: StationSessionCompleteRequest,
        _options: StationCommandOptions,
      ) => makeStationReceipt({ operation: 'return-session' }),
    ),
  }
}

export function createStudioBackendStub(
  options: {
    readonly dispose?: () => void
    readonly core?: Record<string, unknown>
    readonly config?: Record<string, unknown>
  } = {},
) {
  return {
    dispose: options.dispose ?? vi.fn(),
    config: {
      id: 'test-backend',
      name: 'Test OS',
      protocol: 'unilab/v1',
      apiUrl: 'http://os.test',
      auth: 'none',
      serverKind: 'edge',
      workspaceMode: 'singleton',
      stationId: 'local',
      ...options.config,
    },
    core: { ...options.core },
    getCapabilityStatus: () => ({ available: true, reason: null }),
  }
}

/** 需要工站处置上下文的组件都必须在这些 provider 里渲染。 */
export function StationProviders({ children }: { children: ReactNode }) {
  return (
    <BackendProvider>
      <StationHandlingProvider>{children}</StationHandlingProvider>
    </BackendProvider>
  )
}
