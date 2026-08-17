const APPLICATION_ENTRY_NAMES = ['bundle', 'secondary-window']
const WORKER_ENTRY_NAMES = ['editor.worker', 'plugin-worker']
const REQUIRE_MODULE = /\brequire\((['"])([^'"]+)\1\)/g

export function createApplicationPartitionEntryPoints(generatedSources) {
  const modules = new Set()
  for (const source of generatedSources) {
    for (const match of source.matchAll(REQUIRE_MODULE)) modules.add(match[2])
  }
  return Object.fromEntries([...modules].sort().map((module, index) => [
    `partition-seeds/${String(index).padStart(3, '0')}`,
    module
  ]))
}

function selectEntryPoints(entryPoints, names) {
  if (!entryPoints || Array.isArray(entryPoints)) {
    throw new Error('Workbench browser entryPoints 必须是命名对象')
  }
  return Object.fromEntries(names.map(name => {
    const entryPoint = entryPoints[name]
    if (!entryPoint) {
      throw new Error(`Workbench browser entryPoints 缺少 ${name}`)
    }
    return [name, entryPoint]
  }))
}

/**
 * Split Theia's generated browser build into ESM application entries and
 * classic single-file workers. The first pass includes worker entry points as
 * partition seeds, then the second pass overwrites those two entry files with
 * classic workers. Theia creates both workers without `{ type: 'module' }`.
 */
export function createWorkbenchBrowserBuildOptions(browserOptions, partitionEntryPoints = {}) {
  // Keeping workers in this pass moves framework code shared with the app out
  // of bundle.js. These ESM worker entry files are never shipped: the classic
  // worker pass below replaces them before the build finishes.
  const requiredEntryPoints = selectEntryPoints(
    browserOptions.entryPoints,
    [...APPLICATION_ENTRY_NAMES, ...WORKER_ENTRY_NAMES]
  )
  const applicationEntryPoints = selectEntryPoints(
    requiredEntryPoints,
    APPLICATION_ENTRY_NAMES
  )
  const workerEntryPoints = selectEntryPoints(
    requiredEntryPoints,
    WORKER_ENTRY_NAMES
  )
  const application = {
    ...browserOptions,
    entryPoints: {
      ...applicationEntryPoints,
      'partition-seeds/worker-editor': workerEntryPoints['editor.worker'],
      'partition-seeds/worker-plugin': workerEntryPoints['plugin-worker'],
      ...partitionEntryPoints
    },
    entryNames: '[name]',
    chunkNames: 'chunks/[name]-[hash]',
    format: 'esm',
    splitting: true
  }
  const workers = {
    ...browserOptions,
    entryPoints: workerEntryPoints,
    entryNames: '[name]',
    format: 'iife',
    splitting: false,
    plugins: browserOptions.plugins.filter(plugin => (
      plugin.name !== 'copy' &&
      plugin.name !== 'unilab-workbench-preload-shell'
    ))
  }
  return { application, workers }
}
