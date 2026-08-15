import { afterEach, describe, expect, it, vi } from 'vitest'

import { getDefaultBackend } from './backends'
import type { HttpClient } from './http'
import { createWorkflowRuntime } from './workflow'

const WORKFLOW_UUID = '11111111-1111-4111-8111-111111111111'
const OTHER_WORKFLOW_UUID = '22222222-2222-4222-8222-222222222222'
const HASH_A = `sha256:${'a'.repeat(64)}`
const HASH_B = `sha256:${'b'.repeat(64)}`

interface PersistentAuthoringPort {
  getWorkflowAuthoring: (workflowUuid: string) => Promise<AuthoringAggregate>
  saveWorkflowAuthoringDraft: (
    workflowUuid: string,
    request: {
      python_source: string
      expected_draft_hash: string | null
      expected_workflow_revision: number
    }
  ) => Promise<AuthoringAggregate>
  applyWorkflowAuthoring: (
    workflowUuid: string,
    request: { candidate_hash: string }
  ) => Promise<{
    apply_result: {
      kind: 'graph' | 'source_only'
      workflow_revision: number
    }
    authoring: AuthoringAggregate
  }>
  validateWorkflowAuthoring: (
    request: AuthoringTransformRequest
  ) => Promise<AuthoringTransform>
  subscribeWorkflowAuthoring: (
    workflowUuid: string,
    onInvalidate: (event: AuthoringChangedEvent) => void,
    options?: {
      lastEventId?: string
      onOpen?: (state: {
        lastEventId: string
        reconnected: boolean
      }) => void
      onError?: (error: Error) => void
    }
  ) => { dispose: () => void }
  dispose: () => void
}

interface AuthoringAggregate {
  workflow_uuid: string
  workflow_revision: number
  state: string
  applied_graph: Record<string, unknown>
  draft: {
    python_source: string
    draft_hash: string
  } | null
  candidate: {
    candidate_hash: string
  } | null
  applied_source: Record<string, unknown> | null
  topology_authoring: {
    authority: 'python_source' | 'managed_exact_graph'
    graph_mode: 'read_write' | 'read_only'
    graph_to_python: 'supported' | 'unsupported'
  }
}

interface AuthoringChangedEvent {
  id: string
  event: 'workflow.authoring.changed'
  data: {
    workflow_uuid: string
    cause: string
    workflow_revision: number
    draft_hash: string | null
    candidate_hash: string | null
  }
}

interface AuthoringTransformRequest {
  workflow_uuid: string
  revision: number
  source_uri: string
  graph: Record<string, unknown>
  python_source: string
}

interface AuthoringTransform {
  diagnostics: unknown[]
  graph: Record<string, unknown> | null
  normalized_python_source: string | null
  source_map: unknown[]
  changeset: Record<string, unknown> | null
  compiler_version: string
  template_catalog_fingerprint: string
}

const aggregate: AuthoringAggregate = {
  workflow_uuid: WORKFLOW_UUID,
  workflow_revision: 7,
  state: 'unapplied_source_only',
  applied_graph: {
    workflow: { uuid: WORKFLOW_UUID },
    nodes: [],
    edges: [],
    node_templates: [],
    handle_templates: []
  },
  draft: {
    python_source: 'result = build()\n',
    draft_hash: HASH_A
  },
  candidate: { candidate_hash: HASH_B },
  applied_source: null,
  topology_authoring: {
    authority: 'python_source',
    graph_mode: 'read_write',
    graph_to_python: 'supported'
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('persistent workflow authoring port', () => {
  it('uses the Workflow-scoped GET and dual-CAS Draft PUT contracts', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ code: 0, data: aggregate })
      .mockResolvedValueOnce({ code: 0, data: aggregate })
    const runtime = persistentPort(request)

    await expect(
      runtime.getWorkflowAuthoring(WORKFLOW_UUID)
    ).resolves.toEqual(aggregate)
    await expect(
      runtime.saveWorkflowAuthoringDraft(WORKFLOW_UUID, {
        python_source: 'result = build()\n# local edit\n',
        expected_draft_hash: HASH_A,
        expected_workflow_revision: 7
      })
    ).resolves.toEqual(aggregate)

    expect(request).toHaveBeenNthCalledWith(
      1,
      `/api/v1/workflows/${WORKFLOW_UUID}/authoring`,
      undefined
    )
    expect(request).toHaveBeenNthCalledWith(
      2,
      `/api/v1/workflows/${WORKFLOW_UUID}/authoring/draft`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          python_source: 'result = build()\n# local edit\n',
          expected_draft_hash: HASH_A,
          expected_workflow_revision: 7
        })
      })
    )
  })

  it('sends exactly the one server-issued Candidate token when applying', async () => {
    const request = vi.fn().mockResolvedValue({
      code: 0,
      data: {
        apply_result: {
          kind: 'source_only',
          workflow_revision: 7
        },
        authoring: aggregate
      }
    })
    const runtime = persistentPort(request)

    await runtime.applyWorkflowAuthoring(WORKFLOW_UUID, {
      candidate_hash: HASH_B
    })

    const [, init] = request.mock.calls[0] as [string, RequestInit]
    expect(request.mock.calls[0]?.[0]).toBe(
      `/api/v1/workflows/${WORKFLOW_UUID}/authoring/apply`
    )
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      candidate_hash: HASH_B
    })
  })

  it('validates a persistent graph/source pair through the closed transform port', async () => {
    const transform: AuthoringTransform = {
      diagnostics: [],
      graph: aggregate.applied_graph,
      normalized_python_source: 'result = build()\n',
      source_map: [],
      changeset: null,
      compiler_version: 'i1-e2e',
      template_catalog_fingerprint: HASH_A
    }
    const request = vi.fn()
      .mockResolvedValueOnce({ code: 0, data: transform })
      .mockResolvedValueOnce({
        code: 0,
        data: { ...transform, unexpected: true }
      })
    const runtime = persistentPort(request)
    const body: AuthoringTransformRequest = {
      workflow_uuid: WORKFLOW_UUID,
      revision: 7,
      source_uri: 'package://production_lab/workflows/demo.py',
      graph: aggregate.applied_graph,
      python_source: 'result = build()\n'
    }

    await expect(runtime.validateWorkflowAuthoring(body))
      .resolves.toEqual(transform)
    expect(request.mock.calls[0]?.[0]).toBe('/api/v1/authoring/validate')
    const init = request.mock.calls[0]?.[1] as RequestInit
    expect(init.method).toBe('POST')
    const requestBody = JSON.parse(
      String(init.body)
    ) as Record<string, unknown>
    expect(requestBody).toEqual(body)
    expect(Object.keys(requestBody)).toEqual([
      'workflow_uuid',
      'revision',
      'source_uri',
      'graph',
      'python_source'
    ])

    await expect(runtime.validateWorkflowAuthoring(body))
      .rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' })
  })

  it.each([
    ['missing code', { data: aggregate }],
    ['non-zero code', { code: 17, data: aggregate, message: 'rejected' }]
  ])('rejects a %s Authoring success envelope', async (_label, response) => {
    const runtime = persistentPort(vi.fn().mockResolvedValue(response))

    await expect(
      runtime.getWorkflowAuthoring(WORKFLOW_UUID)
    ).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' })
  })

  it.each([
    ['missing topology authoring capability', undefined],
    ['unknown topology authority', {
      authority: 'bioyond_day1',
      graph_mode: 'read_only',
      graph_to_python: 'unsupported'
    }],
    ['inconsistent managed exact capability', {
      authority: 'managed_exact_graph',
      graph_mode: 'read_write',
      graph_to_python: 'unsupported'
    }]
  ])('rejects %s', async (_label, topologyAuthoring) => {
    const data = { ...aggregate } as Record<string, unknown>
    if (topologyAuthoring === undefined) {
      delete data.topology_authoring
    } else {
      data.topology_authoring = topologyAuthoring
    }
    const runtime = persistentPort(vi.fn().mockResolvedValue({
      code: 0,
      data
    }))

    await expect(runtime.getWorkflowAuthoring(WORKFLOW_UUID))
      .rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' })
  })

  it('accepts the managed exact read-only topology capability', async () => {
    const managedExact = {
      ...aggregate,
      topology_authoring: {
        authority: 'managed_exact_graph' as const,
        graph_mode: 'read_only' as const,
        graph_to_python: 'unsupported' as const
      }
    }
    const runtime = persistentPort(vi.fn().mockResolvedValue({
      code: 0,
      data: managedExact
    }))

    await expect(runtime.getWorkflowAuthoring(WORKFLOW_UUID))
      .resolves.toEqual(managedExact)
  })

  /** 证明产品 Edge 的工作流身份拒绝不会在严格解码时丢失细分错误。 */
  it('保留产品 Edge 返回的工作流身份拒绝', async () => {
    const message = [
      `导入的 Python 声明工作流 ${OTHER_WORKFLOW_UUID}，`,
      `当前编辑的是 ${WORKFLOW_UUID}`
    ].join('')
    const runtime = persistentPort(vi.fn().mockResolvedValue({
      code: 3003,
      error: {
        code: 'workflow_identity_mismatch',
        msg: message
      }
    }))

    await expect(
      runtime.saveWorkflowAuthoringDraft(WORKFLOW_UUID, {
        python_source: 'imported S06 source',
        expected_draft_hash: HASH_A,
        expected_workflow_revision: 7
      })
    ).rejects.toMatchObject({
      code: 'workflow_identity_mismatch',
      message
    })
  })

  it('resumes SSE with Last-Event-ID and de-duplicates by event ID', async () => {
    const streamController: {
      current?: ReadableStreamDefaultController<Uint8Array>
    } = {}
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController.current = controller
      }
    })
    const fetcher = vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' }
    }))
    vi.stubGlobal('fetch', fetcher)
    const errors: Error[] = []
    const opens: Array<{ lastEventId: string; reconnected: boolean }> = []
    const invalidations: AuthoringChangedEvent[] = []
    const runtime = persistentPort(vi.fn())

    const subscription = runtime.subscribeWorkflowAuthoring(
      WORKFLOW_UUID,
      (event) => invalidations.push(event),
      {
        lastEventId: '40',
        onOpen: (state) => opens.push(state),
        onError: (error) => errors.push(error)
      }
    )

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:18003/api/v1/events')
    expect(new Headers(init.headers).get('Accept')).toBe('text/event-stream')
    expect(new Headers(init.headers).get('Last-Event-ID')).toBe('40')
    expect(opens).toEqual([{ lastEventId: '40', reconnected: false }])

    streamController.current?.enqueue(new TextEncoder().encode([
      'id: 41',
      'event: workflow.runtime.changed',
      `data: ${JSON.stringify({ workflow_task_uuid: 'task-1' })}`,
      '',
      'id: 42',
      'event: workflow.authoring.changed',
      `data: ${JSON.stringify(changedData(OTHER_WORKFLOW_UUID, HASH_A, HASH_B))}`,
      '',
      'id: 43',
      'event: workflow.authoring.changed',
      `data: ${JSON.stringify(changedData(WORKFLOW_UUID, HASH_A, HASH_B))}`,
      '',
      'id: 43',
      'event: workflow.authoring.changed',
      `data: ${JSON.stringify(changedData(WORKFLOW_UUID, HASH_A, HASH_B))}`,
      '',
      'id: 44',
      'event: workflow.authoring.changed',
      `data: ${JSON.stringify(changedData(WORKFLOW_UUID, HASH_A, HASH_B))}`,
      '',
      'id: 45',
      'event: workflow.authoring.changed',
      `data: ${JSON.stringify(changedData(WORKFLOW_UUID, HASH_B, null))}`,
      '',
      ''
    ].join('\n')))

    await vi.waitFor(() => expect(invalidations).toHaveLength(3))
    expect(invalidations.map((event) => event.id)).toEqual(['43', '44', '45'])
    expect(errors).toEqual([])

    subscription.dispose()
    expect((init.signal as AbortSignal).aborted).toBe(true)
    runtime.dispose()
  })

  /**
   * 验证浏览器恢复在线会立即替换半开的工作流创作（Authoring）失效流，并携带最后持久游标。
   *
   * 参数：无。返回：断言完成后无值。
   * 异常：未重连、旧流未中止或恢复游标错误时由断言报告失败。
   */
  const verifyAuthoringReconnectOnBrowserOnline = async (): Promise<void> => {
    const networkEvents = new EventTarget()
    /**
     * 注册测试内的浏览器网络生命周期监听器。
     *
     * 参数：`type` 是事件类型，`listener` 是监听器。返回：无。异常：测试事件
     * 目标拒绝监听器时原样传播。
     */
    const addNetworkListener = (
      type: string,
      listener: EventListenerOrEventListenerObject
    ): void => networkEvents.addEventListener(type, listener)
    /**
     * 移除测试内的浏览器网络生命周期监听器。
     *
     * 参数：`type` 是事件类型，`listener` 是原监听器。返回：无。异常：无。
     */
    const removeNetworkListener = (
      type: string,
      listener: EventListenerOrEventListenerObject
    ): void => networkEvents.removeEventListener(type, listener)
    const addNetworkEventListener = vi.fn(addNetworkListener)
    const removeNetworkEventListener = vi.fn(removeNetworkListener)
    vi.stubGlobal('addEventListener', addNetworkEventListener)
    vi.stubGlobal('removeEventListener', removeNetworkEventListener)

    const initial = controlledSseResponse()
    const reconnected = controlledSseResponse()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(initial.response)
      .mockResolvedValueOnce(reconnected.response)
    vi.stubGlobal('fetch', fetcher)
    const invalidations: AuthoringChangedEvent[] = []
    const opens: Array<{ lastEventId: string; reconnected: boolean }> = []
    /**
     * 收集工作流创作（Authoring）失效通知。
     *
     * 参数：`event` 是已解码的小型失效通知。返回：无。异常：无。
     */
    const recordInvalidation = (event: AuthoringChangedEvent): void => {
      invalidations.push(event)
    }
    /**
     * 收集每次 SSE 打开时的恢复状态。
     *
     * 参数：`state` 含发起连接时的游标和重连标志。返回：无。异常：无。
     */
    const recordOpen = (state: {
      lastEventId: string
      reconnected: boolean
    }): void => {
      opens.push(state)
    }
    const runtime = persistentPort(vi.fn())
    const subscription = runtime.subscribeWorkflowAuthoring(
      WORKFLOW_UUID,
      recordInvalidation,
      { onOpen: recordOpen }
    )

    /**
     * 断言初始 SSE 请求已经发出。
     *
     * 参数：无。返回：断言完成后无值。异常：请求数不为一时由断言抛出。
     */
    const expectInitialSseRequest = (): void => {
      expect(fetcher).toHaveBeenCalledOnce()
    }
    await vi.waitFor(expectInitialSseRequest)
    initial.controller.enqueue(new TextEncoder().encode([
      'id: 46',
      'event: workflow.authoring.changed',
      `data: ${JSON.stringify(changedData(WORKFLOW_UUID, HASH_A, HASH_B))}`,
      '',
      ''
    ].join('\n')))
    /**
     * 断言初始流的失效通知已经消费。
     *
     * 参数：无。返回：断言完成后无值。异常：通知数不为一时由断言抛出。
     */
    const expectInitialInvalidation = (): void => {
      expect(invalidations).toHaveLength(1)
    }
    await vi.waitFor(expectInitialInvalidation)

    networkEvents.dispatchEvent(new Event('online'))
    /**
     * 断言浏览器上线后立即发出第二个 SSE 请求。
     *
     * 参数：无。返回：断言完成后无值。异常：请求数不为二时由断言抛出。
     */
    const expectReconnectRequest = (): void => {
      expect(fetcher).toHaveBeenCalledTimes(2)
    }
    await vi.waitFor(expectReconnectRequest)

    const [, initialInit] = fetcher.mock.calls[0] as [string, RequestInit]
    const [, reconnectInit] = fetcher.mock.calls[1] as [string, RequestInit]
    expect((initialInit.signal as AbortSignal).aborted).toBe(true)
    expect(new Headers(reconnectInit.headers).get('Last-Event-ID')).toBe('46')
    expect(opens).toEqual([
      { lastEventId: '', reconnected: false },
      { lastEventId: '46', reconnected: true }
    ])

    subscription.dispose()
    expect((reconnectInit.signal as AbortSignal).aborted).toBe(true)
    expect(removeNetworkEventListener).toHaveBeenCalledWith(
      'online',
      expect.any(Function)
    )
    networkEvents.dispatchEvent(new Event('online'))
    expect(fetcher).toHaveBeenCalledTimes(2)
    runtime.dispose()
  }

  it(
    '浏览器恢复在线时立即携带持久游标重连工作流创作（Authoring）SSE',
    verifyAuthoringReconnectOnBrowserOnline
  )
})

/** 测试可控的服务器发送事件（SSE）响应与字节流控制器。 */
interface ControlledSseResponse {
  response: Response
  controller: ReadableStreamDefaultController<Uint8Array>
}

/**
 * 创建可由测试推进、保持打开的 SSE 响应。
 *
 * 参数：无。返回：响应与其字节流控制器。
 * 异常：运行环境缺少 Web Streams 时由构造器抛出。
 */
function controlledSseResponse(): ControlledSseResponse {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  /**
   * 保存新建流的控制器，供测试写入 SSE 帧。
   *
   * 参数：`value` 是 Web Streams 创建的控制器。返回：无。异常：无。
   */
  const captureController = (
    value: ReadableStreamDefaultController<Uint8Array>
  ): void => {
    controller = value
  }
  const stream = new ReadableStream<Uint8Array>({ start: captureController })
  if (!controller) throw new Error('SSE test stream controller was not installed')
  return {
    response: new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' }
    }),
    controller
  }
}

function persistentPort(
  request: ReturnType<typeof vi.fn>
): PersistentAuthoringPort {
  return createWorkflowRuntime(
    mockHttp(request),
    getDefaultBackend('local-python')
  ) as unknown as PersistentAuthoringPort
}

function mockHttp(request: ReturnType<typeof vi.fn>): HttpClient {
  return {
    request: async <ResponseValue>(
      path: string,
      init?: RequestInit
    ): Promise<ResponseValue> =>
      request(path, init) as Promise<ResponseValue>
  }
}

function changedData(
  workflowUuid: string,
  draftHash: string | null,
  candidateHash: string | null
): AuthoringChangedEvent['data'] {
  return {
    workflow_uuid: workflowUuid,
    cause: 'draft_saved',
    workflow_revision: 7,
    draft_hash: draftHash,
    candidate_hash: candidateHash
  }
}
