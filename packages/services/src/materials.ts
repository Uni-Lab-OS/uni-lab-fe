import type {
  CreateMaterialInput,
  CreateMaterialResult,
  LabPose,
  MaterialAggregate,
  MaterialAnchor,
  MaterialGraphPort,
  MaterialPlacement,
  MaterialScope,
  MaterialSite,
  MaterialContainerLayout,
  MaterialTemplateCatalog,
  MaterialTemplateCatalogPort,
  MaterialTemplateDetail,
  MaterialTemplateGeometry,
  MaterialTemplateSummary
} from '@unilab/material'

import { parseShapeLibrary, type MaterialShapeLibrary } from '@unilab/material/domain'

import type { BackendConfig } from './backends'
import { getCapabilityStatus, type ServerCapabilities } from './capabilities'
import { assertCapability, ServiceError } from './errors'
import {
  loadBackendMaterialTemplateCatalog,
  loadBackendMaterialTemplateDetail
} from './backendMaterialCatalog'
import { requestData, type HttpClient } from './http'
import { mapBackendMaterialGraph } from './materialBackendGraphCodec'
import {
  createIdempotencyKey,
  isRecord,
  optionalString
} from './materialCodecPrimitives'
import { mapCreateMaterialResult } from './materialLegacyGraphCodec'
import {
  mapTemplateCatalog,
  mapTemplateDetail
} from './materialTemplateCodec'

export type {
  MaterialScope,
  MaterialTemplateCatalog,
  MaterialTemplateDetail,
  MaterialTemplateSummary
} from '@unilab/material'

export type MaterialService = MaterialTemplateCatalogPort & MaterialGraphPort

/**
 * 创建统一物料服务，把部署差异收敛在 Backend/OS adapter 内。
 *
 * @param http 已绑定当前服务地址的 HTTP 客户端。
 * @param backend 当前服务 Profile 与能力来源。
 * @param capabilities 已探测的服务能力集合。
 * @returns 组件唯一依赖的物料模板与物料图端口。
 */
export function createMaterialService(
  http: HttpClient,
  backend: BackendConfig,
  capabilities: ServerCapabilities
): MaterialService {
  const requireReadTemplates = (): void => {
    assertCapability(
      getCapabilityStatus(
        backend,
        capabilities,
        'material.readTemplates'
      ),
      'material.readTemplates'
    )
  }

  const requireReadGraph = (): void => {
    assertCapability(
      getCapabilityStatus(
        backend,
        capabilities,
        'material.readGraph'
      ),
      'material.readGraph'
    )
  }

  const requireCreate = (): void => {
    assertCapability(
      getCapabilityStatus(
        backend,
        capabilities,
        'material.create'
      ),
      'material.create'
    )
  }

  return {
    listTemplates: async (scope) => {
      requireReadTemplates()
      assertSingletonScope(scope)

      if (backend.serverKind === 'backend') return loadBackendMaterialTemplateCatalog(http)

      const response = await requestData<Record<string, unknown>>(
        http,
        '/api/v1/resource-templates'
      )
      return mapTemplateCatalog(response, backend.apiUrl)
    },

    getTemplate: async (scope, templateId) => {
      requireReadTemplates()
      assertSingletonScope(scope)

      if (backend.serverKind === 'backend') return loadBackendMaterialTemplateDetail(http, templateId)

      const response = await requestData<Record<string, unknown>>(
        http,
        `/api/v1/resource-templates/${encodeURIComponent(templateId)}`
      )
      return mapTemplateDetail(response, backend.apiUrl)
    },

    /** 读取公共物料图；Local 与 Backend 必须发布同一权威 Material.revision。 */
    getGraph: async (scope) => {
      requireReadGraph()
      assertSingletonScope(scope)
      const response = await requestData<Record<string, unknown>>(
        http,
        '/api/v1/materials/graph'
      )
      return mapBackendMaterialGraph(response)
    },
    subscribeMoves: (onMove) => {
      if (backend.serverKind === 'backend') return { dispose: () => undefined }
      const EventSourceConstructor = globalThis.EventSource
      if (typeof EventSourceConstructor !== 'function') {
        return { dispose: () => undefined }
      }
      const endpoint = `${backend.apiUrl.replace(/\/$/, '')}/api/v1/monitor/events?channels=material&backlog=0`
      const source = new EventSourceConstructor(endpoint)
      const onMaterial = (rawEvent: Event): void => {
        const event = rawEvent as MessageEvent<string>
        try {
          const frame = JSON.parse(event.data) as unknown
          if (!isRecord(frame) || frame.channel !== 'material') return
          const data = isRecord(frame.data) ? frame.data : {}
          if (frame.type !== 'instance.moved') return
          const payload = isRecord(data.payload) ? data.payload : {}
          const materialId = optionalString(data.aggregate_id)
          const toParentId = optionalString(payload.to_parent)
          if (!materialId || !toParentId) return
          onMove({
            id: event.lastEventId || String(frame.seq ?? ''),
            materialId,
            revision:
              typeof data.version === 'number' ? data.version : undefined,
            fromParentId: optionalString(payload.from_parent),
            fromSite: optionalString(payload.from_slot),
            toParentId,
            toSite: optionalString(payload.to_slot)
          })
        } catch {
          // 单个非法移动帧不能污染现有物料图或中断后续事件。
        }
      }
      source.addEventListener('material', onMaterial)
      return {
        dispose: () => {
          source.removeEventListener('material', onMaterial)
          source.close()
        }
      }
    },
    createMaterial: async (scope, input) => {
      requireCreate()
      assertSingletonScope(scope)
      const response = await requestData<Record<string, unknown>>(
        http,
        '/api/v1/materials',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template_id: input.templateId,
            name: input.name,
            placement: input.placement,
            initial_contents: input.initialContents,
            ...(input.config ? { config: input.config } : {}),
            expected_revision: input.expectedRevision ?? 0,
            idempotency_key: createIdempotencyKey()
          })
        }
      )
      return mapCreateMaterialResult(response)
    },
    undoCreate: async (command) => {
      assertCapability(
        getCapabilityStatus(
          backend,
          capabilities,
          'edge.undoCreate'
        ),
        'edge.undoCreate'
      )
      await requestData<Record<string, never>>(
        http,
        `/api/v1/materials/${encodeURIComponent(command.materialId)}/undo-create`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            creation_operation_id: command.creationOperationId,
            expected_revision: command.expectedRevision,
            idempotency_key: command.idempotencyKey
          })
        }
      )
    },

    /**
     * 读取当前已生成物料的公共 2.5D 外形目录。
     * 无参数；返回已校验外形数组，旧服务缺少端点或请求失败时返回空数组以诚实降级。
     */
    getShapeLibrary: async () =>
      requestData<{ items?: unknown }>(
        http,
        '/api/v1/material-shapes'
      )
        .then((response) => parseShapeLibrary(response.items))
        // 目录来自当前物料快照而非静态模板；不做跨刷新永久缓存。
        .catch(() => [] as MaterialShapeLibrary),

    updateConfig: async (_command) =>
      unavailableGraphOperation('material.updateConfig'),
    move: async (_command) =>
      unavailableGraphOperation('material.move'),
    attach: async (_command) =>
      unavailableGraphOperation('material.attach'),
    detach: async (_command) =>
      unavailableGraphOperation('material.detach'),
    updateSite: async (_command) =>
      unavailableGraphOperation('material.updateSite'),
    getEdgeOperations: async (_scope, _operationIds) =>
      unavailableGraphOperation('edge.provisioning')
  }

  function unavailableGraphOperation(
    capability: import('./capabilities').ServerCapability
  ): never {
    assertCapability(
      getCapabilityStatus(backend, capabilities, capability),
      capability
    )
    throw new ServiceError({
      code: 'MATERIAL_GRAPH_ADAPTER_NOT_IMPLEMENTED',
      message: `${capability} 已声明，但当前 adapter 尚未实现`,
      retryable: false
    })
  }
}

function assertSingletonScope(scope: MaterialScope): void {
  if (scope.kind === 'singleton') return
  throw new ServiceError({
    code: 'UNSUPPORTED_MATERIAL_SCOPE',
    message: '当前 Material adapter 只支持 singleton scope',
    retryable: false
  })
}
