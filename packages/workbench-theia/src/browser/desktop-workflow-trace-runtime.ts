import type { WorkflowTracePort } from '@unilab/workflow-editor'

interface DesktopObservabilityGlobal {
  api?: {
    observability?: Partial<WorkflowTracePort>
  }
  window?: DesktopObservabilityGlobal
  location?: Pick<Location, 'search'>
}

/**
 * Resolve the Electron preload trace bridge without requiring it in web mode.
 */
export function desktopWorkflowTraceRuntime(
  scope: unknown = globalThis
): WorkflowTracePort | undefined {
  const desktopScope = scope as DesktopObservabilityGlobal | undefined
  const observability = desktopScope?.window?.api?.observability ??
    desktopScope?.api?.observability
  if (
    typeof observability?.listTraces === 'function' &&
    typeof observability.getTrace === 'function'
  ) {
    return observability as WorkflowTracePort
  }
  if (new URLSearchParams(desktopScope?.location?.search ?? '')
    .has('workbenchConnection')) {
    return undefined
  }
  return {
    listTraces: async query => requireDesktopObservability(desktopScope)
      .listTraces(query),
    getTrace: async (traceId, query) => requireDesktopObservability(desktopScope)
      .getTrace(traceId, query)
  }
}

function requireDesktopObservability(
  scope: DesktopObservabilityGlobal | undefined
): WorkflowTracePort {
  const observability = scope?.window?.api?.observability ??
    scope?.api?.observability
  if (
    typeof observability?.listTraces !== 'function' ||
    typeof observability.getTrace !== 'function'
  ) {
    throw new Error('Desktop Trace 服务尚未就绪，请稍后重试')
  }
  return observability as WorkflowTracePort
}
