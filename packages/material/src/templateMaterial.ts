import type {
  CreateMaterialInput,
  InitialMaterialContentDraft,
  MaterialDropIntent
} from './types'

export interface MaterialTemplateInput {
  uuid: string
  displayName: string
}

export type MaterialTemplateKind = 'device' | 'resource'
export type MaterialTemplateStatus = 'ready' | 'unresolved'
export type MaterialTemplateCatalogSection = 'material' | 'reagent'

export interface MaterialTemplateCreation {
  mode: 'dynamic-device' | 'resource-tree'
  available: boolean
  reason?: string
}

export interface MaterialTemplatePoint {
  x: number
  y: number
}

export interface MaterialTemplateVector3 {
  x: number
  y: number
  z: number
}

export interface MaterialTemplateGeometry {
  dimensionsMm: MaterialTemplateVector3
  originMm: MaterialTemplateVector3
  footprint?: {
    pointsMm: readonly MaterialTemplatePoint[]
  }
  stackHeightMm?: number
}

export interface MaterialContainerGeometry {
  dimensionsMm: MaterialTemplateVector3
  depthMm: number
  shape: 'circle' | 'rectangle'
  maxVolumeUl?: number
}

export type MaterialContainerLayout =
  | {
      type: 'grid'
      containerKind: 'well' | 'tip-spot' | 'container'
      rows: readonly string[]
      columns: number
      columnLabels: readonly number[]
      naming: 'row-column'
      geometry: MaterialContainerGeometry & {
        pitchMm: MaterialTemplatePoint
        offsetMm: MaterialTemplateVector3
        firstKey: string
      }
    }
  | {
      type: 'explicit'
      containers: readonly {
        key: string
        kind: 'well' | 'tip-spot' | 'container'
        positionMm: MaterialTemplateVector3
        geometry: Partial<MaterialContainerGeometry>
      }[]
    }

export interface MaterialTemplateCompatibility {
  allowedParentTypes?: readonly string[]
  allowedSiteTypes?: readonly string[]
  requiredCapabilities?: readonly string[]
  forbiddenSiteTypes?: readonly string[]
}

export interface MaterialTemplateConfiguration {
  schema: Record<string, unknown>
  uiSchema: Record<string, unknown>
}

export interface MaterialTemplateSummary {
  uuid: string
  key: string
  sourceNamespace: string
  kind: MaterialTemplateKind
  displayName: string
  tags: readonly string[]
  categoryPath: readonly string[]
  /** 应用目录分区；只决定入口归属，不改变 ResourceTemplate 或 Material 的权威语义。 */
  catalogSection?: MaterialTemplateCatalogSection
  icon?: string
  description?: string
  status: MaterialTemplateStatus
  statusReason?: string
  contentHash: string
  creation: MaterialTemplateCreation
}

export interface MaterialTemplateDetail extends MaterialTemplateSummary {
  geometry?: MaterialTemplateGeometry
  containerLayout?: MaterialContainerLayout
  compatibility: MaterialTemplateCompatibility
  configuration: MaterialTemplateConfiguration
  assets: Readonly<Record<string, string>>
}

export interface MaterialTemplateCatalog {
  revision: string
  stale: boolean
  items: readonly MaterialTemplateSummary[]
}

export interface MaterialTemplateCatalogPort {
  listTemplates: (
    scope: import('./types').MaterialScope
  ) => Promise<MaterialTemplateCatalog>
  getTemplate: (
    scope: import('./types').MaterialScope,
    templateId: string
  ) => Promise<MaterialTemplateDetail>
}

export type MaterialNameValidation =
  | {
      valid: true
      value: string
    }
  | {
      valid: false
      value: string
      code: 'required' | 'duplicate'
      message: string
    }

export interface CreateMaterialDraftOptions {
  existingNames: readonly string[]
  requestedName?: string
  placement?: MaterialDropIntent
  initialContents?: readonly InitialMaterialContentDraft[]
  config?: Record<string, unknown>
}

export interface TemplateMaterialDraft {
  createInput: CreateMaterialInput
  nameValidation: MaterialNameValidation
}

/**
 * 创建传输无关草稿；模板结构不会隐式初始化试剂、样品或孔位内容。
 * @param template 用户选择的资源模板身份。
 * @param options 实例名称、初始位置、内容和结构化配置。
 * @returns 可提交的创建命令及实例名称校验结果。
 */
export function createMaterialDraftFromTemplate(
  template: MaterialTemplateInput,
  options: CreateMaterialDraftOptions
): TemplateMaterialDraft {
  const nameValidation = validateMaterialName(
    options.requestedName ?? template.displayName,
    options.existingNames
  )

  return {
    createInput: {
      templateId: template.uuid,
      name: nameValidation.value,
      placement: options.placement ?? { kind: 'unplaced' },
      initialContents: structuredClone(options.initialContents ?? []),
      ...(options.config
        ? { config: structuredClone(options.config) }
        : {})
    },
    nameValidation
  }
}

export function validateMaterialName(
  requestedName: string,
  existingNames: readonly string[]
): MaterialNameValidation {
  const value = requestedName.trim().normalize('NFKC')
  if (!value) {
    return {
      valid: false,
      value,
      code: 'required',
      message: '请输入实例名称'
    }
  }

  const comparable = comparableMaterialName(value)
  const duplicate = existingNames.some(
    (name) => comparableMaterialName(name) === comparable
  )
  if (duplicate) {
    return {
      valid: false,
      value,
      code: 'duplicate',
      message: '当前物料图中已存在同名物料'
    }
  }

  return { valid: true, value }
}

function comparableMaterialName(value: string): string {
  return value.trim().normalize('NFKC').toLowerCase()
}
