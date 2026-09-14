import { execFileSync } from 'node:child_process'

interface ReservationCommandInput {
  python: string
  script: string
  inventoryDatabase: string
  workflowTaskUuid: string
  pythonPath: string
}

/**
 * 在浏览器进程外调用生产库存服务建立真实短期测试占用。
 *
 * @param input 固定 Python、夹具、库存库、任务/节点/物料身份和导入路径。
 * @returns 生产库存服务的预留结果。
 * @throws 子进程失败、JSON 缺失或结果身份漂移时抛出。
 */
export function runReservationReserve(input: ReservationCommandInput & {
  workflowNodeUuid: string
  materialUuid: string
}): { workflow_id: string; reserved_nodes: string[] } {
  const stdout = execFileSync(input.python, [
    input.script,
    'reserve',
    input.inventoryDatabase,
    input.workflowTaskUuid,
    input.workflowNodeUuid,
    input.materialUuid
  ], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: input.pythonPath }
  })
  const lines = stdout.trim().split('\n')
  const result = JSON.parse(lines.at(-1) || 'null') as {
    workflow_id?: unknown
    reserved_nodes?: unknown
  } | null
  if (
    !result || result.workflow_id !== input.workflowTaskUuid ||
    !Array.isArray(result.reserved_nodes) ||
    containsNonString(result.reserved_nodes)
  ) {
    throw new Error(`短期预留建立结果无效：${JSON.stringify(result)}`)
  }
  return {
    workflow_id: result.workflow_id,
    reserved_nodes: result.reserved_nodes as string[]
  }
}

/**
 * 在浏览器进程外调用生产库存服务释放一个任务的短期预留。
 *
 * @param input 固定 Python、夹具、库存库、任务身份和导入路径。
 * @returns 生产库存服务的释放结果。
 * @throws 子进程失败、JSON 缺失或结果身份漂移时抛出。
 */
export function runReservationRelease(
  input: ReservationCommandInput
): {
  workflow_id: string
  released_nodes: string[]
  released_bindings: string[]
} {
  const stdout = execFileSync(input.python, [
    input.script,
    'release',
    input.inventoryDatabase,
    input.workflowTaskUuid
  ], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: input.pythonPath }
  })
  const lines = stdout.trim().split('\n')
  const result = JSON.parse(lines.at(-1) || 'null') as {
    workflow_id?: unknown
    released_nodes?: unknown
    released_bindings?: unknown
  } | null
  if (
    !result || result.workflow_id !== input.workflowTaskUuid ||
    !Array.isArray(result.released_nodes) ||
    containsNonString(result.released_nodes) ||
    !Array.isArray(result.released_bindings) ||
    containsNonString(result.released_bindings)
  ) {
    throw new Error(`短期预留释放结果无效：${JSON.stringify(result)}`)
  }
  return {
    workflow_id: result.workflow_id,
    released_nodes: result.released_nodes as string[],
    released_bindings: result.released_bindings as string[]
  }
}

/** 判断不可信数组是否包含非字符串成员。 */
function containsNonString(values: unknown[]): boolean {
  for (const value of values) {
    if (typeof value !== 'string') return true
  }
  return false
}
