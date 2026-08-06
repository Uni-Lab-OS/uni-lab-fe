import type {
  WorkflowAuthoringGraph,
  WorkflowMaterialSourceCatalogSnapshot
} from '@unilab/services'

import type { WorkflowNode } from './parseWorkflow'

type AuthoringHandleTemplate = WorkflowAuthoringGraph['handle_templates'][number]
type AuthoringNodeTemplate = WorkflowAuthoringGraph['node_templates'][number]
type MaterialSourceTemplate =
  WorkflowMaterialSourceCatalogSnapshot['resourceTemplates'][number]
type ProjectedHandle = NonNullable<WorkflowNode['handles']>[number]

export function resourceTemplateIndex(
  catalog?: Pick<
    WorkflowMaterialSourceCatalogSnapshot,
    'resourceTemplates'
  > | null
): Map<string, MaterialSourceTemplate> {
  return new Map((catalog?.resourceTemplates ?? []).map((template) => [
    template.uuid,
    template
  ]))
}

export function nodeTemplateIndex(
  graph: WorkflowAuthoringGraph
): Map<string, AuthoringNodeTemplate> {
  return new Map(graph.node_templates.map((template) => [
    String(template.uuid || ''),
    template
  ]))
}

export function handleTemplateIndex(
  graph: WorkflowAuthoringGraph
): Map<string, WorkflowNode['handles']> {
  const index = new Map<string, WorkflowNode['handles']>()
  for (const template of graph.handle_templates) {
    const projected = projectHandleTemplate(template)
    if (!projected) continue
    const { templateUuid, handle } = projected
    const handles = index.get(templateUuid) ?? []
    handles.push(handle)
    index.set(templateUuid, handles)
  }
  return index
}

function projectHandleTemplate(
  template: AuthoringHandleTemplate
): { templateUuid: string; handle: ProjectedHandle } | null {
  const templateUuid = String(template.workflow_node_template_uuid || '')
  const ioType = String(template.io_type || '')
  if (!templateUuid || (ioType !== 'source' && ioType !== 'target')) return null
  const handleKey = String(template.handle_key || '')
  const displayName = String(template.display_name || handleKey)
  return {
    templateUuid,
    handle: {
      uuid: String(template.uuid || ''),
      handleKey,
      displayName,
      ioType,
      ...projectHandlePresentation(template, handleKey, displayName),
      ...projectHandleContract(template)
    }
  }
}

function projectHandlePresentation(
  template: AuthoringHandleTemplate,
  handleKey: string,
  displayName: string
): Pick<ProjectedHandle, 'title' | 'description'> {
  const metaData = isRecord(template.meta_data) ? template.meta_data : {}
  const unilab = isRecord(metaData.unilab) ? metaData.unilab : {}
  const valueSchema = isRecord(unilab.value_schema)
    ? unilab.value_schema
    : undefined
  const dataKey = typeof template.data_key === 'string'
    ? template.data_key
    : null
  const schemaTitle = valueSchema
    ? nullableString(valueSchema.title)
    : null
  const schemaDescription = valueSchema
    ? nullableString(valueSchema.description)
    : null
  const title = nullableString(template.title) ?? schemaTitle ?? (
    displayName !== (dataKey || handleKey) ? displayName : null
  )
  const description = nullableString(template.description) ?? schemaDescription
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {})
  }
}

function projectHandleContract(
  template: AuthoringHandleTemplate
): Omit<ProjectedHandle, 'uuid' | 'handleKey' | 'displayName' | 'ioType'> {
  const metaData = isRecord(template.meta_data) ? template.meta_data : {}
  const unilab = isRecord(metaData.unilab) ? metaData.unilab : {}
  const valueSchema = isRecord(unilab.value_schema)
    ? unilab.value_schema
    : undefined
  const allowlist = stringArrayOrNull(
    unilab.allowed_resource_template_uuids
  )
  return {
    ...(typeof template.type === 'string'
      ? { valueType: template.type }
      : {}),
    ...(valueSchema ? { valueSchema } : {}),
    ...(typeof template.data_key === 'string' || template.data_key === null
      ? { dataKey: template.data_key }
      : {}),
    ...(typeof unilab.editor_control === 'string' ||
      unilab.editor_control === null
      ? { editorControl: unilab.editor_control }
      : {}),
    ...(allowlist !== undefined
      ? { allowedResourceTemplateUuids: allowlist }
      : {}),
    ...(typeof unilab.implicit_passthrough === 'boolean'
      ? { implicitPassthrough: unilab.implicit_passthrough }
      : {})
  }
}

function stringArrayOrNull(value: unknown): string[] | null | undefined {
  if (value === null) return null
  if (!Array.isArray(value)) return undefined
  if (!value.every((item) => typeof item === 'string')) return undefined
  return [...value]
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
