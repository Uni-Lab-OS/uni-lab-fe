import type {
  WorkflowActionCatalogSnapshot,
  WorkflowAuthoringAggregate,
  WorkflowAuthoringGraph,
  WorkflowAuthoringTransformResult,
  WorkflowDefinitionPort,
  WorkflowRuntimePort
} from '@unilab/services'

import {
  type AuthoringOperationQueue,
  catalogConflictDecision,
  isTemplateCatalogConflict
} from './persistentAuthoringSession'
import { rehydrateTypedActionGraph } from './workflowActionCatalog'

export interface WorkflowCanvasValidationCache {
  sourceGraph: WorkflowAuthoringGraph
  workflowRevision: number
  result: WorkflowAuthoringTransformResult
}

interface GenerateValidatedWorkflowPythonOptions {
  actionCatalogFingerprint: string
  authority: WorkflowAuthoringAggregate
  cache: { current: WorkflowCanvasValidationCache | null }
  definitionPort: WorkflowDefinitionPort
  localCanvasDirty: boolean
  localEditorValue: string
  queue: AuthoringOperationQueue
  refreshCatalog: () => Promise<{
    action: WorkflowActionCatalogSnapshot
  }>
  runtime: WorkflowRuntimePort
  sourceGraph: WorkflowAuthoringGraph
  workflowUuid: string
  onCatalogRehydrated: (graph: WorkflowAuthoringGraph) => void
  onDiagnostics: (
    diagnostics: WorkflowAuthoringTransformResult['diagnostics']
  ) => void
}

/** 生成并校验 Canonical 画布草稿；不持久化也不应用候选。 */
export async function generateValidatedWorkflowPython({
  actionCatalogFingerprint,
  authority,
  cache,
  definitionPort,
  localCanvasDirty,
  localEditorValue,
  queue,
  refreshCatalog,
  runtime,
  sourceGraph,
  workflowUuid,
  onCatalogRehydrated,
  onDiagnostics
}: GenerateValidatedWorkflowPythonOptions): Promise<WorkflowAuthoringTransformResult> {
  if (!definitionPort.capabilities.sourceEditing) {
    throw new Error(
      definitionPort.capabilities.sourceEditingDisabledReason ??
      '当前数据源不支持工作区源码编辑'
    )
  }
  const cached = cache.current
  if (
    cached?.sourceGraph === sourceGraph &&
    cached.workflowRevision === authority.workflow_revision
  ) {
    onDiagnostics(cached.result.diagnostics)
    return cached.result
  }
  const sourceUri = authority.draft?.source_uri
  if (!sourceUri) throw new Error('当前工作流尚未注册软件包中的 Python 草稿')
  const request = (graph: WorkflowAuthoringGraph) => queue.run(
    () => runtime.generateWorkflowAuthoringPython({
      workflow_uuid: workflowUuid,
      revision: authority.workflow_revision,
      source_uri: sourceUri,
      graph
    })
  )
  let graphValue = sourceGraph
  let generated: WorkflowAuthoringTransformResult | null = null
  let catalogFailure: unknown = null
  try {
    generated = await request(graphValue)
  } catch (generateError) {
    if (!isTemplateCatalogConflict(generateError)) throw generateError
    catalogFailure = generateError
  }
  const diagnosticCatalogMismatch = generated?.diagnostics.some(
    (diagnostic) => diagnostic.code === 'template_catalog_mismatch' ||
      diagnostic.code === 'template_catalog_conflict'
  ) ?? false
  if (catalogFailure || diagnosticCatalogMismatch) {
    const refreshedCatalog = (await refreshCatalog()).action
    const decision = catalogConflictDecision({
      dirty: localCanvasDirty,
      localPython: localEditorValue,
      localGraph: sourceGraph,
      observedFingerprint:
        authority.candidate?.template_catalog_fingerprint ??
        authority.applied_source?.template_catalog_fingerprint ??
        actionCatalogFingerprint,
      currentFingerprint: refreshedCatalog.fingerprint ?? ''
    })
    if (!decision) {
      if (catalogFailure) throw catalogFailure
      throw new Error('操作目录已变化，但未返回新的版本标识')
    }
    graphValue = rehydrateTypedActionGraph(
      refreshedCatalog,
      decision.retainLocalGraph
    )
    onCatalogRehydrated(graphValue)
    generated = await request(graphValue)
  }
  if (!generated) throw new Error('OS 未返回工作流转换结果')
  onDiagnostics(generated.diagnostics)
  let blocking = generated.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error'
  )
  if (blocking.length > 0 || !generated.normalized_python_source) {
    throw new Error(
      blocking.map((item) => `${item.code}: ${item.message}`).join('\n') ||
      'OS 未返回完整规范化 Python'
    )
  }
  if (!generated.graph) throw new Error('OS 未返回完整画布数据')
  const validated = await queue.run(
    () => runtime.validateWorkflowAuthoring({
      workflow_uuid: workflowUuid,
      revision: authority.workflow_revision,
      source_uri: sourceUri,
      graph: generated.graph as WorkflowAuthoringGraph,
      python_source: generated.normalized_python_source as string
    })
  )
  onDiagnostics(validated.diagnostics)
  blocking = validated.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error'
  )
  if (
    blocking.length > 0 || !validated.graph ||
    !validated.normalized_python_source
  ) {
    throw new Error(
      blocking.map((item) => `${item.code}: ${item.message}`).join('\n') ||
      'OS 未通过编辑中入参与出参校验'
    )
  }
  cache.current = {
    sourceGraph: graphValue,
    workflowRevision: authority.workflow_revision,
    result: validated
  }
  return validated
}
