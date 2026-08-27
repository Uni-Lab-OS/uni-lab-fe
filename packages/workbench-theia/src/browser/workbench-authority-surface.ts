import type { WorkbenchSessionSnapshot } from '@unilab/workbench-session'

/** Keep the last usable workbench mounted while authority switching restarts runtimes. */
export function authoritySurfaceSnapshot(
  current: WorkbenchSessionSnapshot,
  stable: WorkbenchSessionSnapshot | null,
  switching: boolean
): WorkbenchSessionSnapshot {
  return switching && stable ? stable : current
}
