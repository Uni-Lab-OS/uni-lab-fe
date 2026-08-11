import type {
  MaterialAggregate,
  ManagedMaterialComponent,
  MaterialGraphPort,
  MaterialPlacement,
  MaterialSite
} from './types'

export function materialAggregate(
  id: string,
  options: {
    templateId?: string
    revision?: number
    placement?: MaterialPlacement
    sites?: readonly MaterialSite[]
    config?: Record<string, unknown>
    component?: ManagedMaterialComponent
  } = {}
): MaterialAggregate {
  return {
    material: {
      id,
      sourceTemplateId: options.templateId ?? `template-${id}`,
      code: id.toUpperCase(),
      name: id,
      component: options.component,
      config: options.config ?? {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    placement: options.placement ?? {
      kind: 'world',
      pose: {
        positionMm: [0, 0, 0],
        rotationDegXYZ: [0, 0, 0]
      }
    },
    sites: options.sites ?? [],
    revision: options.revision ?? 1
  }
}

export function materialGraphPort(
  overrides: Partial<MaterialGraphPort> = {}
): MaterialGraphPort {
  const unsupported = async (): Promise<never> => {
    throw new Error('Unexpected MaterialGraphPort call')
  }
  return {
    getGraph: unsupported,
    createMaterial: unsupported,
    undoCreate: unsupported,
    updateConfig: unsupported,
    move: unsupported,
    attach: unsupported,
    detach: unsupported,
    updateSite: unsupported,
    deleteSubtree: unsupported,
    getEdgeOperations: unsupported,
    ...overrides
  }
}
