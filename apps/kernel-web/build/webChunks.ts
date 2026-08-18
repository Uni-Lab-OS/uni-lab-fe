const WORKSPACE_CHUNKS: ReadonlyArray<readonly [string, string]> = [
  ['/packages/workflow-editor/', 'feature-workflow'],
  ['/packages/workflow-ide-bridge/', 'feature-workflow'],
  ['/packages/code-editor/', 'feature-workflow'],
  ['/packages/material/', 'feature-material'],
  ['/packages/device-card-', 'feature-device-cards'],
  ['/packages/device-management/', 'feature-devices'],
  ['/packages/device-provisioning/', 'feature-devices']
]

const DEPENDENCY_CHUNKS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[\\/]node_modules[\\/].pnpm[\\/](?:react|react-dom|scheduler|use-sync-external-store)@/, 'vendor-react'],
  [/[\\/]node_modules[\\/].pnpm[\\/](?:@tanstack\+react-query|zustand)@/, 'vendor-state'],
  [/[\\/]node_modules[\\/].pnpm[\\/]elkjs@/, 'vendor-workflow-layout'],
  [/[\\/]node_modules[\\/].pnpm[\\/]three@[^/]+[\\/]node_modules[\\/]three[\\/](?:examples|addons)[\\/]/, 'vendor-three-addons'],
  [/[\\/]node_modules[\\/].pnpm[\\/]three@/, 'vendor-three-core'],
  [/[\\/]node_modules[\\/].pnpm[\\/]@pascal-app\+editor@/, 'vendor-pascal-editor'],
  [/[\\/]node_modules[\\/].pnpm[\\/]@pascal-app\+(?:core|viewer|lingo)@/, 'vendor-pascal-runtime'],
  [/[\\/]node_modules[\\/].pnpm[\\/](?:@react-three\+[^@/]+|postprocessing|three-mesh-bvh|three-stdlib|camera-controls|react-reconciler)@/, 'vendor-react-three'],
  [/[\\/]node_modules[\\/].pnpm[\\/](?:@codemirror\+[^@/]+|@lezer\+[^@/]+|codemirror)@/, 'vendor-code-editor'],
  [/[\\/]node_modules[\\/].pnpm[\\/](?:@xyflow\+[^@/]+|reactflow|@dagrejs\+[^@/]+)@/, 'vendor-diagrams']
]

/**
 * Assign stable, responsibility-based names to production Web chunks.
 *
 * The matcher understands pnpm's virtual-store paths and workspace source
 * paths. Returning undefined leaves small application modules to Rollup so it
 * can preserve dynamic-import boundaries such as SceneWorkbench.
 */
export function webChunkName(id: string): string | undefined {
  const normalizedId = id.replaceAll('\\\\', '/')

  for (const [pathFragment, chunkName] of WORKSPACE_CHUNKS) {
    if (normalizedId.includes(pathFragment)) return chunkName
  }

  for (const [dependencyPattern, chunkName] of DEPENDENCY_CHUNKS) {
    if (dependencyPattern.test(normalizedId)) return chunkName
  }

  return undefined
}
