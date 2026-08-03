import type {
  WorkflowEventSubscription,
  WorkflowNodeJob,
  WorkflowNodeJobFeedback,
  WorkflowRuntimePort,
  WorkflowTask,
  WorkflowTaskCommand,
  WorkflowTaskCommandType,
  WorkflowTaskRuntimeEvent,
  WorkflowTaskRunMode
} from '@unilab/services'

export interface WorkflowTaskRuntimeSnapshot {
  loading: boolean
  task: WorkflowTask | null
  jobs: readonly WorkflowNodeJob[]
  events: readonly WorkflowTaskRuntimeEvent[]
  feedback: readonly WorkflowNodeJobFeedback[]
  lastCommand: WorkflowTaskCommand | null
  error: string | null
  actionError: string | null
  projectionError: string | null
  eventError: string | null
  feedbackError: string | null
  realtimeError: string | null
  projectionStale: boolean
  eventStale: boolean
  feedbackStale: boolean
  realtimeStatus: 'connecting' | 'live' | 'reconnecting'
  generation: number
}

type WorkflowTaskRuntimeListener = () => void

export class WorkflowTaskController {
  private readonly listeners = new Set<WorkflowTaskRuntimeListener>()
  private snapshot: WorkflowTaskRuntimeSnapshot = {
    loading: true,
    task: null,
    jobs: [],
    events: [],
    feedback: [],
    lastCommand: null,
    error: null,
    actionError: null,
    projectionError: null,
    eventError: null,
    feedbackError: null,
    realtimeError: null,
    projectionStale: false,
    eventStale: false,
    feedbackStale: false,
    realtimeStatus: 'connecting',
    generation: 0
  }
  private subscription: WorkflowEventSubscription | null = null
  private started = false
  private active = true
  private commandSequence = 0
  private queuedTaskUuid: string | null | undefined
  private refreshInFlight: Promise<void> | null = null

  constructor(
    private readonly runtime: WorkflowRuntimePort,
    private readonly workflowUuid: string
  ) {}

  getSnapshot = (): WorkflowTaskRuntimeSnapshot => this.snapshot

  subscribe = (listener: WorkflowTaskRuntimeListener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async start(): Promise<void> {
    if (this.started || !this.active) return
    this.started = true
    this.subscription = this.runtime.subscribeWorkflowRuntime(
      (event) => {
        if (event.event !== 'workflow.runtime.changed') return
        void this.requestRefresh(event.data.workflow_task_uuid)
      },
      {
        onOpen: () => {
          this.install({ realtimeStatus: 'live', realtimeError: null })
          void this.requestRefresh(this.snapshot.task?.uuid ?? null)
        },
        onError: (error) => {
          this.install({
            realtimeStatus: 'reconnecting',
            realtimeError: `Runtime 实时同步中断：${error.message}`
          })
        }
      }
    )
    await this.requestRefresh(null)
  }

  async refresh(): Promise<void> {
    await this.requestRefresh(this.snapshot.task?.uuid ?? null)
  }

  async create(
    runMode: Exclude<WorkflowTaskRunMode, 'single_node'>,
    input?: Record<string, unknown>
  ): Promise<WorkflowTask> {
    this.install({ actionError: null })
    try {
      const created = await this.runtime.createWorkflowTask({
        workflow_uuid: this.workflowUuid,
        run_mode: runMode,
        ...(input === undefined ? {} : { input })
      })
      if (this.active) {
        this.install({ lastCommand: null })
        await this.requestRefresh(created.uuid)
      }
      return created
    } catch (error) {
      this.install({ actionError: errorMessage(error), loading: false })
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
    } catch (error) {
      this.install({ actionError: errorMessage(error) })
      throw error
    }
  }

  clearError(): void {
    this.install({
      actionError: null,
      projectionError: null,
      eventError: null,
      feedbackError: null,
      realtimeError: null
    })
  }

  dispose(): void {
    if (!this.active) return
    this.active = false
    this.subscription?.dispose()
    this.subscription = null
    this.listeners.clear()
  }

  private requestRefresh(taskUuid: string | null): Promise<void> {
    if (!this.active) return Promise.resolve()
    this.queuedTaskUuid = taskUuid
    if (this.refreshInFlight) return this.refreshInFlight
    this.refreshInFlight = this.drainRefreshQueue().finally(() => {
      this.refreshInFlight = null
    })
    return this.refreshInFlight
  }

  private async drainRefreshQueue(): Promise<void> {
    while (this.active && this.queuedTaskUuid !== undefined) {
      const taskUuid = this.queuedTaskUuid
      this.queuedTaskUuid = undefined
      await this.hydrate(taskUuid)
    }
  }

  private async hydrate(requestedTaskUuid: string | null): Promise<void> {
    try {
      let taskUuid = requestedTaskUuid
      if (taskUuid === null) {
        const page = await this.runtime.listWorkflowTasks({
          workflow_uuid: this.workflowUuid,
          page: 1,
          page_size: 1
        })
        if (!this.active) return
        taskUuid = page.items[0]?.uuid ?? null
        if (taskUuid === null) {
          this.install({
            loading: false,
            task: null,
            jobs: [],
            events: [],
            feedback: [],
            projectionError: null,
            eventError: null,
            feedbackError: null,
            projectionStale: false,
            eventStale: false,
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
      if (!this.active || task.workflow_uuid !== this.workflowUuid) return
      const sortedJobs = [...jobs].sort(
        (left, right) => left.topological_index - right.topological_index
      )
      const taskChanged = this.snapshot.task?.uuid !== task.uuid
      this.install({
        loading: false,
        task,
        jobs: sortedJobs,
        ...(taskChanged ? { events: [], feedback: [] } : {}),
        projectionError: null,
        projectionStale: false,
        generation: this.snapshot.generation + 1
      })
      await this.hydrateEvents(task.uuid)
      await this.hydrateFeedback(task.uuid, sortedJobs)
    } catch (error) {
      this.install({
        loading: false,
        projectionError: errorMessage(error),
        projectionStale: this.snapshot.task !== null
      })
    }
  }

  private async hydrateEvents(taskUuid: string): Promise<void> {
    let events = this.snapshot.task?.uuid === taskUuid
      ? [...this.snapshot.events]
      : []
    try {
      let cursor = events.reduce(
        (maximum, item) => Math.max(maximum, item.sequence),
        0
      )
      while (true) {
        const page = await this.runtime.listWorkflowTaskEvents(taskUuid, {
          after_sequence: cursor,
          limit: 100
        })
        events.push(...page.items)
        const nextCursor = Math.max(
          page.next_cursor,
          ...page.items.map((item) => item.sequence)
        )
        if (page.has_more && nextCursor <= cursor) {
          throw new Error('Workflow runtime event cursor 未向前推进')
        }
        cursor = Math.max(cursor, nextCursor)
        if (!page.has_more) break
      }
      this.install({
        events: uniqueRuntimeEvents(events),
        eventStale: false,
        eventError: null
      })
    } catch (error) {
      this.install({
        events: uniqueRuntimeEvents(events),
        eventStale: true,
        eventError: errorMessage(error)
      })
    }
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
    type: WorkflowTaskCommandType
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
      next.eventError ?? next.feedbackError ?? next.realtimeError
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

function uniqueRuntimeEvents(
  items: readonly WorkflowTaskRuntimeEvent[]
): WorkflowTaskRuntimeEvent[] {
  const sequences = new Set<number>()
  return [...items]
    .sort((left, right) => left.sequence - right.sequence)
    .filter((item) => {
      if (sequences.has(item.sequence)) return false
      sequences.add(item.sequence)
      return true
    })
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
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
