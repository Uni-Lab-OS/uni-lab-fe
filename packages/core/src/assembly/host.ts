import type { BackendCore } from './backend'
import { createBackendCoreFromTransport } from './backend'
import type { RequestTransport } from '../transport/request'

export type ProductHostKind = 'browser' | 'desktop' | 'workbench'

export type ProductHostCapability =
  | 'web_session'
  | 'window_lifecycle'
  | 'local_process_bridge'
  | 'workspace'
  | 'theia_extension'

export interface ProductHostDescriptor {
  readonly kind: ProductHostKind
  readonly profileId: string
  readonly capabilities: readonly ProductHostCapability[]
}

export interface ProductHostAssemblyOptions {
  readonly kind: ProductHostKind
  readonly transport: RequestTransport
  readonly profileId?: string
  readonly capabilities?: readonly ProductHostCapability[]
}

export interface ProductHostAssembly {
  readonly host: ProductHostDescriptor
  readonly core: BackendCore
}

export function createProductHostAssembly(
  options: ProductHostAssemblyOptions,
): ProductHostAssembly {
  return {
    host: {
      kind: options.kind,
      profileId: options.profileId ?? options.kind,
      capabilities: options.capabilities ?? defaultCapabilities(options.kind),
    },
    core: createBackendCoreFromTransport(options.transport),
  }
}

export const HOST_ASSEMBLY_EVALUATION = {
  browser: {
    transport: 'FetchTransport',
    hostResponsibilities: ['web session', 'navigation', 'capability presentation'],
  },
  desktop: {
    transport: 'injected RequestTransport',
    hostResponsibilities: ['window lifecycle', 'local process bridge', 'packaging'],
  },
  workbench: {
    transport: 'injected RequestTransport',
    hostResponsibilities: ['workspace', 'Theia extension', 'panel lifecycle'],
  },
} as const

function defaultCapabilities(kind: ProductHostKind): readonly ProductHostCapability[] {
  switch (kind) {
    case 'browser':
      return ['web_session']
    case 'desktop':
      return ['window_lifecycle', 'local_process_bridge']
    case 'workbench':
      return ['workspace', 'theia_extension']
  }
}
