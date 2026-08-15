import { ServiceError } from './errors'
import { requestData, type HttpClient } from './http'
import type {
  WorkflowNodeJobFeedback,
  WorkflowNodeJobFeedbackPage,
  WorkflowNodeJobFeedbackQuery,
  WorkflowRunPreflightCheck,
  WorkflowRunPreflightReport,
  WorkflowTaskCreateRequest,
  WorkflowTaskRunMode
} from './workflowTaskContracts'

export { loadBackendWorkflowRunPreparation } from './backendWorkflowDefinition'

interface BackendFeedbackPage {
  items: WorkflowNodeJobFeedback[]
  has_more: boolean
  page: number
  page_size: number
}

const BACKEND_FEEDBACK_PAGE_SIZE = 500
const BACKEND_FEEDBACK_PAGE_BUDGET = 100

/**
 * 将共享工作流任务（WorkflowTask）创建请求收敛为 Backend 当前接受的 DTO。
 *
 * @param request 前端工作流运行端口接收的共享创建请求。
 * @returns 只包含 Backend 当前权威字段的 JSON 对象；OS-only `input` 不会越界发送。
 */
export function backendWorkflowTaskCreateBody(
  request: WorkflowTaskCreateRequest
): Omit<WorkflowTaskCreateRequest, 'input'> {
  if (request.input && Object.keys(request.input).length > 0) {
    throw new ServiceError({
      code: 'BACKEND_WORKFLOW_INPUT_UNSUPPORTED',
      message: 'Backend 当前不接受工作流任务输入，请先把输入固化到工作流定义',
      retryable: false
    })
  }
  if (request.run_mode === 'single_node' && !request.target_node_uuid) {
    throw new ServiceError({
      code: 'BACKEND_WORKFLOW_TARGET_REQUIRED',
      message: '单节点运行必须明确选择目标工作流节点',
      retryable: false
    })
  }
  if (request.run_mode !== 'single_node' && request.target_node_uuid) {
    throw new ServiceError({
      code: 'BACKEND_WORKFLOW_TARGET_INVALID',
      message: '只有单节点运行可以指定目标工作流节点',
      retryable: false
    })
  }
  const {
    input: _osOnlyInput,
    inventory_bindings: inventoryBindings = [],
    ...shared
  } = request
  // inventoryBindings 是本次工作流任务的任务物料预留（TaskMaterialReservation）输入。
  return {
    ...shared,
    inventory_bindings: inventoryBindings
  }
}

/**
 * 读取 Backend 对候选正式运行范围的权威只读预检。
 *
 * @param http 已绑定 Backend 权威地址的 HTTP 客户端。
 * @param workflowUuid 待运行的工作流（Workflow）稳定身份。
 * @param runMode 完整、单步或单节点正式运行模式。
 * @param targetNodeUuid 单节点模式下明确选择的工作流节点身份。
 * @returns 可运行性、检查计数与可定位的诊断项。
 * @throws 请求范围不完整或 Backend 响应破坏合同时关闭失败。
 */
export async function loadBackendWorkflowRunPreflight(
  http: HttpClient,
  workflowUuid: string,
  runMode: WorkflowTaskRunMode,
  targetNodeUuid?: string
): Promise<WorkflowRunPreflightReport> {
  if (runMode === 'single_node' && !targetNodeUuid) {
    throw invalidBackendRunPreflight('single_node target is required')
  }
  if (runMode !== 'single_node' && targetNodeUuid) {
    throw invalidBackendRunPreflight('target is only valid for single_node')
  }
  const search = new URLSearchParams({ run_mode: runMode })
  if (targetNodeUuid) search.set('target_node_uuid', targetNodeUuid)
  const raw = await requestData<unknown>(
    http,
    `/api/v1/workflows/${encodeURIComponent(workflowUuid)}/run-preflight?${search.toString()}`
  )
  return decodeBackendRunPreflight(
    raw,
    workflowUuid,
    runMode,
    targetNodeUuid
  )
}

/**
 * 把 Backend 页码反馈接口适配为前端稳定的反馈序号游标。
 *
 * @param http 已绑定 Backend 权威地址的 HTTP 客户端。
 * @param jobUuid 工作流节点作业（WorkflowNodeJob）的稳定身份。
 * @param query 前端已消费的反馈序号与单次补读上限。
 * @returns 严格递增、可继续补读的反馈序号页。
 */
export async function loadBackendWorkflowNodeJobFeedback(
  http: HttpClient,
  jobUuid: string,
  query: WorkflowNodeJobFeedbackQuery = {}
): Promise<WorkflowNodeJobFeedbackPage> {
  const afterSequence = nonNegativeInteger(query.after_sequence, 0)
  const limit = positiveInteger(query.limit, 50, BACKEND_FEEDBACK_PAGE_SIZE)
  const accepted: WorkflowNodeJobFeedback[] = []
  const identities = new Set<string>()
  let backendHasMore = false

  for (
    let page = 1;
    page <= BACKEND_FEEDBACK_PAGE_BUDGET;
    page += 1
  ) {
    const search = new URLSearchParams({
      page: String(page),
      page_size: String(BACKEND_FEEDBACK_PAGE_SIZE)
    })
    const backendPage = await requestData<BackendFeedbackPage>(
      http,
      `/api/v1/workflow-node-jobs/${encodeURIComponent(jobUuid)}/feedback?${search.toString()}`
    )
    validateBackendFeedbackPage(backendPage, page)
    const candidates = backendPage.items.filter(
      (item) => item.sequence > afterSequence
    )
    for (const item of candidates) {
      const identity = `${item.workflow_node_job_uuid}:${item.sequence}`
      if (identities.has(identity)) {
        throw invalidBackendFeedback('duplicate Job feedback sequence')
      }
      identities.add(identity)
      accepted.push(item)
    }
    backendHasMore = backendPage.has_more
    if (accepted.length >= limit || !backendPage.has_more) break
    if (page === BACKEND_FEEDBACK_PAGE_BUDGET) {
      throw invalidBackendFeedback('page budget exceeded')
    }
  }

  accepted.sort((left, right) => left.sequence - right.sequence)
  const items = accepted.slice(0, limit)
  const nextCursor = items.at(-1)?.sequence ?? afterSequence
  return {
    items,
    next_cursor: nextCursor,
    has_more: accepted.length > items.length || backendHasMore
  }
}

/** 校验 Backend 节点作业反馈页没有破坏页码、序号或数组合同。 */
function validateBackendFeedbackPage(
  page: BackendFeedbackPage,
  expectedPage: number
): void {
  if (
    !page ||
    !Array.isArray(page.items) ||
    typeof page.has_more !== 'boolean' ||
    page.page !== expectedPage ||
    page.page_size !== BACKEND_FEEDBACK_PAGE_SIZE
  ) {
    throw invalidBackendFeedback('invalid numbered page')
  }
  if (page.items.some((item) => (
    !Number.isSafeInteger(item.sequence) || item.sequence < 1
  ))) {
    throw invalidBackendFeedback('sequence must be a positive safe integer')
  }
}

/** 校验 Backend 运行预检的身份、枚举、计数和检查数组。 */
function decodeBackendRunPreflight(
  value: unknown,
  workflowUuid: string,
  runMode: WorkflowTaskRunMode,
  targetNodeUuid?: string
): WorkflowRunPreflightReport {
  const report = asRecord(value)
  const summary = asRecord(report.summary)
  const expectedTarget = targetNodeUuid ?? undefined
  if (
    report.workflow_uuid !== workflowUuid ||
    report.run_mode !== runMode ||
    (report.target_node_uuid ?? undefined) !== expectedTarget ||
    !positiveSafeInteger(report.workflow_revision) ||
    !isRunPreflightStatus(report.status) ||
    typeof report.can_run !== 'boolean' ||
    !nonEmptyString(report.checked_at) ||
    !validPreflightSummary(summary) ||
    !Array.isArray(report.checks)
  ) {
    throw invalidBackendRunPreflight('invalid report identity or summary')
  }
  const checks = report.checks.map(decodeBackendRunPreflightCheck)
  return {
    workflow_uuid: workflowUuid,
    workflow_revision: report.workflow_revision,
    run_mode: runMode,
    ...(expectedTarget ? { target_node_uuid: expectedTarget } : {}),
    status: report.status,
    can_run: report.can_run,
    checked_at: report.checked_at,
    summary: {
      execution_node_count: summary.execution_node_count,
      passed_check_count: summary.passed_check_count,
      blocking_check_count: summary.blocking_check_count,
      deferred_check_count: summary.deferred_check_count,
      confirmation_required_count: summary.confirmation_required_count
    },
    checks
  }
}

/** 校验并复制一项 Backend 运行预检诊断。 */
function decodeBackendRunPreflightCheck(value: unknown): WorkflowRunPreflightCheck {
  const check = asRecord(value)
  if (
    !nonEmptyString(check.type) ||
    !isRunPreflightCheckStatus(check.status) ||
    !nonEmptyString(check.code) ||
    !nonEmptyString(check.message) ||
    typeof check.blocking !== 'boolean' ||
    (check.node_uuid !== undefined && !nonEmptyString(check.node_uuid)) ||
    (check.node_name !== undefined && typeof check.node_name !== 'string') ||
    !isRecord(check.details)
  ) {
    throw invalidBackendRunPreflight('invalid preflight check')
  }
  return {
    type: check.type,
    status: check.status,
    code: check.code,
    message: check.message,
    blocking: check.blocking,
    ...(check.node_uuid === undefined ? {} : { node_uuid: check.node_uuid }),
    ...(check.node_name === undefined ? {} : { node_name: check.node_name }),
    details: check.details
  }
}

/** 判断所有 Backend 预检计数字段都是非负安全整数。 */
function validPreflightSummary(
  value: Record<string, unknown>
): value is Record<string, unknown> & WorkflowRunPreflightReport['summary'] {
  return [
    value.execution_node_count,
    value.passed_check_count,
    value.blocking_check_count,
    value.deferred_check_count,
    value.confirmation_required_count
  ].every(nonNegativeSafeInteger)
}

/** 判断未知值是 Backend 声明的预检汇总结论。 */
function isRunPreflightStatus(
  value: unknown
): value is WorkflowRunPreflightReport['status'] {
  return value === 'ready' ||
    value === 'requires_confirmation' ||
    value === 'blocked'
}

/** 判断未知值是 Backend 声明的单项预检结论。 */
function isRunPreflightCheckStatus(
  value: unknown
): value is WorkflowRunPreflightCheck['status'] {
  return value === 'passed' ||
    value === 'blocked' ||
    value === 'deferred' ||
    value === 'confirmation_required'
}

/** 判断未知值是非空字符串。 */
function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** 判断未知值是非数组对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 把未知值转换为只读解码用的对象视图。 */
function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

/** 判断未知值是正安全整数。 */
function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

/** 判断未知值是非负安全整数。 */
function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

/** 将未知数字收窄为非负整数，否则使用调用方提供的安全默认值。 */
function nonNegativeInteger(value: unknown, fallback: number): number {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? value as number
    : fallback
}

/** 将未知数字收窄到指定正整数上限，否则使用调用方提供的安全默认值。 */
function positiveInteger(
  value: unknown,
  fallback: number,
  maximum: number
): number {
  return Number.isSafeInteger(value) && (value as number) > 0
    ? Math.min(value as number, maximum)
    : fallback
}

/** 创建可诊断、不可重试的 Backend 工作流反馈合同错误。 */
function invalidBackendFeedback(detail: string): ServiceError {
  return new ServiceError({
    code: 'INVALID_BACKEND_WORKFLOW_FEEDBACK',
    message: `Backend 工作流节点反馈响应无效：${detail}`,
    retryable: false
  })
}

/** 创建不可重试的 Backend 工作流运行预检合同错误。 */
function invalidBackendRunPreflight(detail: string): ServiceError {
  return new ServiceError({
    code: 'INVALID_BACKEND_WORKFLOW_RUN_PREFLIGHT',
    message: `Backend 工作流运行预检响应无效：${detail}`,
    retryable: false
  })
}
