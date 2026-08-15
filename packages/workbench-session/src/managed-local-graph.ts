const LOOPBACK_HOST = '127.0.0.1'

/**
 * A Workspace graph may also be used by container deployments, where
 * `plc-sim` is a valid service DNS name. The managed-local OS runs directly on
 * the host, so project only that container alias into the immutable launch
 * copy. The user-owned source graph remains byte-for-byte unchanged.
 */
export function projectManagedLocalGraph(
  graphBytes: Buffer,
  plcSimulatorOpcUaPort: number
): Buffer {
  let graph: unknown
  try {
    graph = JSON.parse(graphBytes.toString('utf8').replace(/^\uFEFF/, ''))
  } catch {
    return graphBytes
  }
  if (!isRecord(graph) || !Array.isArray(graph['nodes'])) return graphBytes

  let changed = false
  for (const node of graph['nodes']) {
    if (!isRecord(node) || !isRecord(node['config'])) continue
    const configuredUrl = node['config']['url']
    if (typeof configuredUrl !== 'string') continue
    try {
      const endpoint = new URL(configuredUrl)
      if (
        endpoint.protocol !== 'opc.tcp:' ||
        endpoint.hostname.toLowerCase() !== 'plc-sim'
      ) continue
      endpoint.hostname = LOOPBACK_HOST
      endpoint.port = String(plcSimulatorOpcUaPort)
      node['config']['url'] = endpoint.toString()
      changed = true
    } catch {
      // Leave non-URL device configuration to the OS graph validator.
    }
  }
  return changed
    ? Buffer.from(`${JSON.stringify(graph, null, 2)}\n`, 'utf8')
    : graphBytes
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}
