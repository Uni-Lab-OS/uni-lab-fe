import type { HttpClient } from './http'

/** 动作节点模板（Action Node Template）的稳定身份。 */
export const nodeUuid = '20000000-0000-4000-8000-000000000001'
/** 动作输入连接点（Handle）的稳定身份。 */
export const targetUuid = '30000000-0000-4000-8000-000000000001'
/** 动作输出连接点（Handle）的稳定身份。 */
export const sourceUuid = '30000000-0000-4000-8000-000000000002'
/** 动作资源模板（ResourceTemplate）的稳定身份。 */
export const resourceTemplateUuid = '10000000-0000-4000-8000-000000000001'
/** 框架节点模板（Framework Node Template）的稳定身份。 */
export const frameworkNodeUuid = '20000000-0000-4000-8000-000000000099'
/** 框架资源模板（ResourceTemplate）的稳定身份。 */
export const frameworkResourceTemplateUuid =
  '10000000-0000-4000-8000-000000000099'
/** OS 扩展目录代际的稳定指纹。 */
export const fingerprint = `sha256:${'a'.repeat(64)}`
/** OS 扩展目录权威（Authority）身份。 */
export const authority = { authority_id: 'os-local', kind: 'local' }
/** 默认节点模板目录的首个 Backend 页码请求。 */
export const defaultCatalogPath =
  '/api/v1/workflow-node-templates?page=1&page_size=100'
/** 发布工作流（PublishedWorkflow）节点模板目录的首个 Backend 页码请求。 */
export const workflowCatalogPath =
  '/api/v1/workflow-node-templates?page=1&page_size=100&node_type=workflow'

/** 测试中最小化的 HTTP 响应信封。 */
export interface Envelope {
  code: number
  data: unknown
}

/** 测试中保留 wire 字段的原始连接点（Handle）。 */
export interface RawHandle {
  uuid: string
  workflow_node_template_uuid: string
  io_type: string
  meta_data: Record<string, unknown>
  [key: string]: unknown
}

/**
 * 读取动作节点模板详情中的连接点（Handle）fixture。
 *
 * @param responses - 以请求路径为键的节点模板目录响应。
 * @returns 动作节点模板详情的连接点集合。
 * @throws 当 fixture 缺少预期详情时，由调用方后续访问暴露测试失败。
 */
export function detailData(responses: Record<string, unknown>): {
  handles: RawHandle[]
} {
  return detailDataFor(responses, nodeUuid)
}

/**
 * 按稳定 UUID 读取节点模板详情 fixture。
 *
 * @param responses - 以请求路径为键的节点模板目录响应。
 * @param templateUuid - 待读取节点模板的稳定 UUID。
 * @returns 保留原始模板与连接点（Handle）的详情对象。
 * @throws 当 UUID 没有对应详情时，由调用方后续访问暴露测试失败。
 */
export function detailDataFor(
  responses: Record<string, unknown>,
  templateUuid: string
): {
  template: Record<string, unknown>
  handles: RawHandle[]
} {
  return (responses[
    `/api/v1/workflow-node-templates/${templateUuid}`
  ] as Envelope).data as {
    template: Record<string, unknown>
    handles: RawHandle[]
  }
}

/**
 * 构造动作（Action）的冻结 JSON Schema fixture。
 *
 * @returns 带物料占位符（ResourceSlot）输入输出合同的动作 Schema。
 * @throws 此纯 fixture 不抛出异常。
 */
export function actionSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      goal: {
        type: 'object',
        properties: {
          sample: { $slot: 'ResourceSlot' },
          mode: {
            type: 'string',
            enum: ['safe', 'fast'],
            default: 'safe'
          }
        },
        required: ['sample'],
        additionalProperties: false
      },
      feedback: {},
      result: {
        type: 'object',
        properties: { sample: { $slot: 'ResourceSlot' } },
        required: ['sample'],
        additionalProperties: false
      }
    },
    required: ['goal'],
    'x-unilabos-action-contract': {
      version: 1,
      input_order: ['sample', 'mode'],
      output_order: ['sample'],
      resource_template_symbols: { goal: {}, result: {} }
    }
  }
}

/**
 * 构造一个动作节点模板目录及详情的完整响应集合。
 *
 * @returns OS 扩展权威和指纹保持一致的节点模板响应表。
 * @throws 此纯 fixture 不抛出异常。
 */
export function catalogResponses(): Record<string, unknown> {
  /** 两个连接点分别证明物料占位符（ResourceSlot）的输入与透传输出。 */
  const handles = [
    {
      uuid: targetUuid,
      workflow_node_template_uuid: nodeUuid,
      handle_key: 'sample.input.v1',
      io_type: 'target',
      display_name: '样品',
      type: 'ResourceSlot',
      required: true,
      data_source: 'goal',
      data_key: 'sample',
      meta_data: {
        unilab: {
          value_schema: { $slot: 'ResourceSlot' },
          editor_control: 'material_port',
          allowed_resource_template_uuids: [resourceTemplateUuid],
          implicit_passthrough: false
        }
      }
    },
    {
      uuid: sourceUuid,
      workflow_node_template_uuid: nodeUuid,
      handle_key: 'sample.output.v1',
      io_type: 'source',
      display_name: '处理后样品',
      type: 'ResourceSlot',
      required: false,
      data_source: 'result',
      data_key: 'sample',
      meta_data: {
        unilab: {
          value_schema: { $slot: 'ResourceSlot' },
          editor_control: 'material_port',
          allowed_resource_template_uuids: [resourceTemplateUuid],
          implicit_passthrough: true
        }
      }
    }
  ]
  return {
    [defaultCatalogPath]: {
      code: 0,
      data: {
        authority,
        catalog_fingerprint: fingerprint,
        items: [{
          uuid: nodeUuid,
          name: 'transfer.sample.v1',
          display_name: '转移样品',
          type: 'UniLabJsonCommand',
          node_type: 'device',
          resource_template: {
            uuid: resourceTemplateUuid,
            name: 'community.szlab.pump',
            display_name: 'SZLab Pump'
          }
        }],
        has_more: false,
        next_cursor_uuid: null
      }
    },
    [workflowCatalogPath]: {
      code: 0,
      data: {
        authority,
        catalog_fingerprint: fingerprint,
        items: [],
        has_more: false,
        next_cursor_uuid: null
      }
    },
    [`/api/v1/workflow-node-templates/${nodeUuid}`]: {
      code: 0,
      data: {
        authority,
        catalog_fingerprint: fingerprint,
        template: {
          uuid: nodeUuid,
          resource_template_uuid: resourceTemplateUuid,
          name: 'transfer.sample.v1',
          display_name: '转移样品',
          class: 'szlab.devices.pump:Pump',
          type: 'UniLabJsonCommand',
          node_type: 'device',
          schema: actionSchema(),
          goal: { sample: 'sample', mode: 'mode' },
          goal_default: { mode: 'safe' },
          feedback: {},
          result: { sample: 'sample' },
          meta_data: {}
        },
        handles
      }
    }
  }
}

/**
 * 构造仅含框架节点的目录，用于验证详情读取并发上限。
 *
 * @param count - 需要生成的框架节点模板数量。
 * @returns 含目录页和每个节点详情的响应表。
 * @throws 当 count 不是可迭代的非负长度时，由 Array.from 抛出异常。
 */
export function frameworkCatalogResponses(
  count: number
): Record<string, unknown> {
  /**
   * 为一个序号生成稳定 UUID 的框架节点摘要。
   *
   * @param _unused - Array.from 提供但本 fixture 不使用的占位值。
   * @param index - 从零开始的框架节点序号。
   * @returns 一个不应投影为动作（Action）的框架节点摘要。
   * @throws 此纯 fixture 回调不抛出异常。
   */
  function createFrameworkSummary(_unused: unknown, index: number) {
    /** UUID 后缀确保每个框架节点模板身份唯一且格式有效。 */
    const suffix = String(index + 1).padStart(12, '0')
    return {
      uuid: `20000000-0000-4000-8000-${suffix}`,
      name: `framework-${index + 1}`,
      display_name: `Framework ${index + 1}`,
      type: 'framework',
      node_type: 'group',
      resource_template: {
        uuid: `10000000-0000-4000-8000-${suffix}`,
        name: 'host_node',
        display_name: 'Host Node'
      }
    }
  }

  const items = Array.from({ length: count }, createFrameworkSummary)
  const responses: Record<string, unknown> = {
    [defaultCatalogPath]: {
      code: 0,
      data: {
        authority,
        catalog_fingerprint: fingerprint,
        items,
        has_more: false,
        next_cursor_uuid: null
      }
    },
    [workflowCatalogPath]: {
      code: 0,
      data: {
        authority,
        catalog_fingerprint: fingerprint,
        items: [],
        has_more: false,
        next_cursor_uuid: null
      }
    }
  }
  for (const item of items) {
    responses[`/api/v1/workflow-node-templates/${item.uuid}`] = {
      code: 0,
      data: {
        authority,
        catalog_fingerprint: fingerprint,
        template: {
          uuid: item.uuid,
          resource_template_uuid: item.resource_template.uuid,
          name: item.name,
          display_name: item.display_name,
          class: 'unilabos.workflow.authoring:group',
          type: item.type,
          node_type: item.node_type,
          schema: null,
          goal: {},
          goal_default: {},
          feedback: {},
          result: {},
          meta_data: { unilab: { framework_owner_only: true } }
        },
        handles: []
      }
    }
  }
  return responses
}

/**
 * 创建只从响应表读取的 HTTP fixture，并记录请求顺序。
 *
 * @param responses - 以完整请求路径为键的响应表。
 * @param requests - 接收真实请求顺序的可变数组。
 * @returns 测试专用 HTTP 客户端。
 * @throws 请求未在响应表中声明时抛出异常，阻止静默接受多余请求。
 */
export function fixtureHttp(
  responses: Record<string, unknown>,
  requests: string[] = []
): HttpClient {
  /**
   * 按完整路径返回隔离副本，避免测试间共享可变 wire 数据。
   *
   * @param path - 目录或详情请求的完整路径。
   * @returns 对应响应的结构化克隆。
   * @throws path 未注册时抛出异常。
   */
  async function request<ResponseValue>(path: string): Promise<ResponseValue> {
    requests.push(path)
    if (!(path in responses)) throw new Error(`Unexpected request: ${path}`)
    return structuredClone(responses[path]) as ResponseValue
  }

  return { request }
}
