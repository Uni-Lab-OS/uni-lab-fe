import type {
  DebugLaunchOverride,
  DebugWorkflowTaskCommand,
  DebugWorkflowTaskPreflight,
  DebugWorkflowTaskProjection,
  WorkflowEventSubscription,
  WorkflowNodeJob,
  WorkflowNodeJobFeedback,
  WorkflowRuntimePort,
  WorkflowTask,
  WorkflowTaskCommand,
  WorkflowTaskCommandType,
  WorkflowTaskRunMode
} from '@unilab/services'

export interface WorkflowTaskRuntimeSnapshot {
  loading: boolean
  task: WorkflowTask | null
  jobs: readonly WorkflowNodeJob[]
  feedback: readonly WorkflowNodeJobFeedback[]
  lastCommand: WorkflowTaskCommand | null
  debug: DebugWorkflowTaskProjection | null
  lastDebugCommand: DebugWorkflowTaskCommand | null
  error: string | null
  actionError: string | null
  projectionError: string | null
  feedbackError: string | null
  realtimeError: string | null
  projectionStale: boolean
  feedbackStale: boolean
  realtimeStatus: 'connecting' | 'live' | 'reconnecting'
  generation: number
}

type WorkflowTaskRuntimeListener = () => void

const FALLBACK_REFRESH_DELAYS_MS = [2_000, 5_000, 10_000, 30_000] as const
const TERMINAL_TASK_STATUSES = new Set<WorkflowTask['status']>([
  'succeeded',
  'failed',
  'canceled',
  'timeout'
])

export class WorkflowTaskController {
  private readonly listeners = new Set<WorkflowTaskRuntimeListener>()
  private snapshot: WorkflowTaskRuntimeSnapshot = {
    loading: true,
    task: null,
    jobs: [],
    feedback: [],
    lastCommand: null,
    debug: null,
    lastDebugCommand: null,
    error: null,
    actionError: null,
    projectionError: null,
    feedbackError: null,
    realtimeError: null,
    projectionStale: false,
    feedbackStale: false,
    realtimeStatus: 'connecting',
    generation: 0
  }
  private subscription: WorkflowEventSubscription | null = null
  private started = false
  private active = true
  private surfaceActive: boolean
  private realtimeLive = false
  private fallbackRefreshAttempt = 0
  private commandSequence = 0
  private queuedTaskUuid: string | null | undefined
  private refreshInFlight: Promise<void> | null = null
  private activeRefreshTimer: ReturnType<typeof globalThis.setTimeout> | null =
    null

  constructor(
    private readonly runtime: WorkflowRuntimePort,
    private readonly workflowUuid: string,
    initialActive = true
  ) {
    this.surfaceActive = initialActive
  }

  getSnapshot = (): WorkflowTaskRuntimeSnapshot => this.snapshot

  subscribe = (listener: WorkflowTaskRuntimeListener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async start(): Promise<void> {
    if (this.started || !this.active) return
    this.started = true
    if (!this.surfaceActive) return
    this.connectRealtime()
    await this.requestRefresh(null)
  }

  /**
   * 暂停或恢复当前 Desktop 业务面的运行时读请求。
   *
   * 隐藏时释放 SSE、取消兜底补读；恢复时重建 SSE 并立即补读一次权威状态。
   */
  setActive(active: boolean): void {
    if (!this.active || this.surfaceActive === active) return
    this.surfaceActive = active
    if (!active) {
      this.realtimeLive = false
      this.queuedTaskUuid = undefined
      this.clearActiveRefreshTimer()
      this.subscription?.dispose()
      this.subscription = null
      return
    }
    if (!this.started) return
    this.fallbackRefreshAttempt = 0
    this.install({ realtimeStatus: 'connecting', realtimeError: null })
    this.connectRealtime()
    void this.requestRefresh(this.snapshot.task?.uuid ?? null)
  }

  private connectRealtime(): void {
    if (!this.active || !this.surfaceActive || this.subscription) return
    try {
      this.subscription = this.runtime.subscribeWorkflowRuntime(
        (event) => {
          if (event.event !== 'workflow.runtime.changed') return
          void this.requestRefresh(event.data.workflow_task_uuid)
        },
        {
          onOpen: () => {
            if (!this.active || !this.surfaceActive) return
            this.realtimeLive = true
            this.fallbackRefreshAttempt = 0
            this.clearActiveRefreshTimer()
            this.install({ realtimeStatus: 'live', realtimeError: null })
            void this.requestRefresh(this.snapshot.task?.uuid ?? null)
          },
          onError: (error) => {
            if (!this.active || !this.surfaceActive) return
            this.realtimeLive = false
            this.fallbackRefreshAttempt = 0
            this.install({
              realtimeStatus: 'reconnecting',
              realtimeError: `Runtime 实时同步中断：${error.message}`
            })
            this.scheduleActiveRefresh()
          }
        }
      )
    } catch (error) {
      this.realtimeLive = false
      this.fallbackRefreshAttempt = 0
      this.install({
        realtimeStatus: 'reconnecting',
        realtimeError: '工作流仍可正常执行；执行期间前端会定时读取最新状态。' +
          '如需恢复实时更新，请确认 Backend 已启用工作流运行事件。'
      })
    }
  }

  async refresh(): Promise<void> {
    await this.requestRefresh(this.snapshot.task?.uuid ?? null)
  }

  /**
   * 创建工作流任务，并在成功响应后异步补读任务、作业与反馈投影。
   * @param runMode 本次工作流任务使用的正常、单步或单节点运行模式。
   * @param input 已按工作流输入合同校验的可选任务输入。
   * @param targetNodeUuid 单节点模式选择的已应用工作流节点身份。
   * @returns OS 创建接口返回的权威工作流任务；返回不等待后续读投影完成。
   * @throws 创建接口失败时保留可行动错误并向调用方传播原始异常。
   */
  async create(
    runMode: WorkflowTaskRunMode,
    input?: Record<string, unknown>,
    targetNodeUuid?: string
  ): Promise<WorkflowTask> {
    this.install({ actionError: null })
    try {
      const created = await this.runtime.createWorkflowTask({
        workflow_uuid: this.workflowUuid,
        run_mode: runMode,
        ...(targetNodeUuid === undefined
          ? {}
          : { target_node_uuid: targetNodeUuid }),
        ...(input === undefined ? {} : { input })
      })
      if (this.active) {
        this.install({ lastCommand: null })
        // 工作流任务创建响应已经是本次提交的权威结果；运行投影独立补读，不能阻塞输入抽屉收敛。
        void this.requestRefresh(created.uuid)
      }
      return created
    } catch (error) {
      this.install({ actionError: errorMessage(error), loading: false })
      throw error
    }
  }

  async createDebug(
    startNodeUuid: string,
    breakpointNodeUuids: readonly string[],
    input?: Record<string, unknown>,
    launchOverrides: readonly DebugLaunchOverride[] = [],
    preflightHash?: string
  ): Promise<WorkflowTask> {
    this.install({ actionError: null })
    try {
      const created = await this.runtime.createDebugWorkflowTask({
        workflow_uuid: this.workflowUuid,
        start_node_uuids: [startNodeUuid],
        breakpoint_node_uuids: [...breakpointNodeUuids],
        ...(input === undefined ? {} : { input }),
        launch_overrides: [...launchOverrides],
        ...(preflightHash === undefined
          ? {}
          : { preflight_hash: preflightHash }),
        meta_data: { source: 'unilab-workbench-debugger' }
      })
      if (this.active) {
        this.install({ lastCommand: null, lastDebugCommand: null })
        void this.requestRefresh(created.uuid)
      }
      return created
    } catch (error) {
      this.install({ actionError: errorMessage(error), loading: false })
      throw error
    }
  }

  async preflightDebug(
    startNodeUuid: string,
    breakpointNodeUuids: readonly string[],
    input?: Record<string, unknown>,
    launchOverrides: readonly DebugLaunchOverride[] = []
  ): Promise<DebugWorkflowTaskPreflight> {
    this.install({ actionError: null })
    try {
      return await this.runtime.preflightDebugWorkflowTask({
        workflow_uuid: this.workflowUuid,
        start_node_uuids: [startNodeUuid],
        breakpoint_node_uuids: [...breakpointNodeUuids],
        ...(input === undefined ? {} : { input }),
        launch_overrides: [...launchOverrides]
      })
    } catch (error) {
      this.install({ actionError: errorMessage(error), loading: false })
      throw error
    }
  }

  async debugCommand(type: 'step' | 'continue'): Promise<void> {
    const task = this.snapshot.task
    const openHold = this.snapshot.debug?.holds.find(
      (hold) => hold.status === 'open'
    )
    if (!task || !openHold) throw new Error('当前调试任务没有可放行的暂停点')
    this.install({ actionError: null })
    try {
      const command = await this.runtime.commandDebugWorkflowTask(task.uuid, {
        type,
        scope: { type: 'hold', hold_uuid: openHold.uuid },
        idempotency_key: this.nextIdempotencyKey(task.uuid, `debug-${type}`)
      })
      if (!this.active) return
      this.install({ lastDebugCommand: command })
      void this.requestRefresh(task.uuid)
    } catch (error) {
      this.install({ actionError: errorMessage(error) })
      throw error
    }
  }

  async command(type: WorkflowTaskCommandType): Promise<void> {
    const task = this.snapshot.task
    if (!task) throw new Error('当前没有可控制的 Workflow Task')
    this.install({ actionError: null })
    try {
      const command = await this.runtime.commandWorkflowTask(task.uuid, {
        type,
        idempotency_key: this.nextIdempotencyKey(task.uuid, type)
      })
      if (!this.active) return
      this.install({ lastCommand: command })
      await this.requestRefresh(task.uuid)
    } catch (error) {
      this.install({ actionError: errorMessage(error) })
      throw error
    }
  }

  clearError(): void {
    this.install({
      actionError: null,
      projectionError: null,
      feedbackError: null,
      realtimeError: null
    })
  }

  dispose(): void {
    if (!this.active) return
    this.active = false
    this.surfaceActive = false
    this.realtimeLive = false
    this.queuedTaskUuid = undefined
    this.clearActiveRefreshTimer()
    this.subscription?.dispose()
    this.subscription = null
    this.listeners.clear()
  }

  private requestRefresh(taskUuid: string | null): Promise<void> {
    if (!this.active || !this.surfaceActive) return Promise.resolve()
    this.queuedTaskUuid = taskUuid
    if (this.refreshInFlight) return this.refreshInFlight
    this.refreshInFlight = this.drainRefreshQueue().finally(() => {
      this.refreshInFlight = null
    })
    return this.refreshInFlight
  }

  private async drainRefreshQueue(): Promise<void> {
    while (
      this.active &&
      this.surfaceActive &&
      this.queuedTaskUuid !== undefined
    ) {
      const taskUuid = this.queuedTaskUuid
      this.queuedTaskUuid = undefined
      await this.hydrate(taskUuid)
    }
  }

  /**
   * 通过全局 SSE 给出的失效身份补读权威任务、作业与反馈游标投影。
   * @param requestedTaskUuid 待补读的任务身份；为 null 时先发现当前工作流任务。
   * @returns 无；补读完成后安装一致的任务/作业快照。
   * @throws REST 异常不会向调用方传播，而会保留上一份快照并标记投影陈旧。
   */
  private async hydrate(requestedTaskUuid: string | null): Promise<void> {
    try {
      let taskUuid = requestedTaskUuid
      if (taskUuid === null) {
        const page = await this.runtime.listWorkflowTasks({
          workflow_uuid: this.workflowUuid,
          page: 1,
          page_size: 1
        })
        if (!this.active || !this.surfaceActive) return
        taskUuid = page.items[0]?.uuid ?? null
        if (taskUuid === null) {
          this.install({
            loading: false,
            task: null,
            jobs: [],
            feedback: [],
            debug: null,
            projectionError: null,
            feedbackError: null,
            projectionStale: false,
            feedbackStale: false,
            generation: this.snapshot.generation + 1
          })
          return
        }
      }
      const [task, jobs] = await Promise.all([
        this.runtime.getWorkflowTask(taskUuid),
        this.runtime.listWorkflowTaskJobs(taskUuid)
      ])
      if (
        !this.active ||
        !this.surfaceActive ||
        task.workflow_uuid !== this.workflowUuid
      ) return
      if (isOlderDifferentTask(this.snapshot.task, task)) return
      const sortedJobs = [...jobs].sort(
        (left, right) => left.topological_index - right.topological_index
      )
      const debug = task.meta_data.debug === true
        ? await this.runtime.getDebugWorkflowTask(task.uuid)
        : null
      const taskChanged = this.snapshot.task?.uuid !== task.uuid
      this.install({
        loading: false,
        task,
        jobs: sortedJobs,
        debug,
        ...(taskChanged ? { feedback: [] } : {}),
        projectionError: null,
        projectionStale: false,
        generation: this.snapshot.generation + 1
      })
      await this.hydrateFeedback(task.uuid, sortedJobs)
    } catch (error) {
      this.install({
        loading: false,
        projectionError: errorMessage(error),
        projectionStale: this.snapshot.task !== null
      })
    } finally {
      this.scheduleActiveRefresh()
    }
  }

  /**
   * 为仍在执行的任务安排一次兜底补读。
   *
   * SSE 负责在线期间的低延迟失效通知；该定时器仅在连接不可用时按退避间隔
   * 保证状态最终收敛。每次补读后重新安排，避免慢请求形成并发轮询。
   */
  private scheduleActiveRefresh(): void {
    this.clearActiveRefreshTimer()
    const task = this.snapshot.task
    if (
      !this.active ||
      !this.surfaceActive ||
      this.realtimeLive ||
      !task ||
      TERMINAL_TASK_STATUSES.has(task.status)
    ) return
    const delay = FALLBACK_REFRESH_DELAYS_MS[Math.min(
      this.fallbackRefreshAttempt,
      FALLBACK_REFRESH_DELAYS_MS.length - 1
    )]
    this.activeRefreshTimer = globalThis.setTimeout(() => {
      this.activeRefreshTimer = null
      this.fallbackRefreshAttempt += 1
      void this.requestRefresh(task.uuid)
    }, delay)
    this.activeRefreshTimer.unref?.()
  }

  private clearActiveRefreshTimer(): void {
    if (this.activeRefreshTimer === null) return
    globalThis.clearTimeout(this.activeRefreshTimer)
    this.activeRefreshTimer = null
  }

  private async hydrateFeedback(
    taskUuid: string,
    jobs: readonly WorkflowNodeJob[]
  ): Promise<void> {
    let feedback = this.snapshot.task?.uuid === taskUuid
      ? [...this.snapshot.feedback]
      : []
    const jobUuids = new Set(jobs.map((job) => job.uuid))
    feedback = feedback.filter((item) =>
      jobUuids.has(item.workflow_node_job_uuid)
    )
    try {
      for (const job of jobs) {
        let cursor = feedback
          .filter((item) => item.workflow_node_job_uuid === job.uuid)
          .reduce((maximum, item) => Math.max(maximum, item.sequence), 0)
        while (job.feedback_sequence > cursor) {
          const page = await this.runtime.listWorkflowNodeJobFeedback(job.uuid, {
            after_sequence: cursor,
            limit: 50
          })
          feedback.push(...page.items)
          const nextCursor = Math.max(
            page.next_cursor,
            ...page.items.map((item) => item.sequence)
          )
          if (page.has_more && nextCursor <= cursor) {
            throw new Error('Workflow feedback cursor 未向前推进')
          }
          cursor = Math.max(cursor, nextCursor)
          if (!page.has_more) break
        }
      }
      this.install({
        feedback: uniqueFeedback(feedback),
        feedbackStale: false,
        feedbackError: null
      })
    } catch (error) {
      this.install({
        feedback: uniqueFeedback(feedback),
        feedbackStale: true,
        feedbackError: errorMessage(error)
      })
    }
  }

  private nextIdempotencyKey(
    taskUuid: string,
    type: string
  ): string {
    this.commandSequence += 1
    return [
      'workflow-ui1b',
      taskUuid,
      type,
      Date.now(),
      this.commandSequence
    ].join(':')
  }

  private install(
    patch: Partial<WorkflowTaskRuntimeSnapshot>
  ): void {
    if (!this.active) return
    const next = { ...this.snapshot, ...patch }
    next.error = next.actionError ?? next.projectionError ??
      next.feedbackError ?? next.realtimeError
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/**
 * 阻止延迟的全局失效事件把面板从较新的工作流任务切回旧任务。
 * 同一任务的任何状态更新仍然允许安装；不同任务只有创建时间严格更新时
 * 才能接管当前投影。
 */
function isOlderDifferentTask(
  current: WorkflowTask | null,
  candidate: WorkflowTask
): boolean {
  if (!current || current.uuid === candidate.uuid) return false
  return Date.parse(candidate.create_time) <= Date.parse(current.create_time)
}

function uniqueFeedback(
  items: readonly WorkflowNodeJobFeedback[]
): WorkflowNodeJobFeedback[] {
  const uuids = new Set<string>()
  const sequences = new Set<string>()
  const idempotencyKeys = new Set<string>()
  return [...items]
    .sort((left, right) =>
      left.received_at.localeCompare(right.received_at) ||
      left.workflow_node_job_uuid.localeCompare(right.workflow_node_job_uuid) ||
      left.sequence - right.sequence
    )
    .filter((item) => {
      const sequence = `${item.workflow_node_job_uuid}:${item.sequence}`
      const idempotency = `${item.workflow_node_job_uuid}:${item.idempotency_key}`
      if (
        uuids.has(item.uuid) ||
        sequences.has(sequence) ||
        idempotencyKeys.has(idempotency)
      ) return false
      uuids.add(item.uuid)
      sequences.add(sequence)
      idempotencyKeys.add(idempotency)
      return true
    })
}
