import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { spawn } from 'node:child_process'
import { open } from 'node:fs/promises'

export interface WorkspaceHostProcessLaunch {
  command: string
  args: readonly string[]
  cwd: string
  environment: NodeJS.ProcessEnv
  detached: boolean
  logPath: string
}

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => Pick<ChildProcess, 'unref'>

/** Spawn one Host with a synchronously available append-only log descriptor. */
export async function launchWorkspaceHostProcess(
  launch: WorkspaceHostProcessLaunch,
  spawnProcess: SpawnProcess = spawn
): Promise<void> {
  // Node 25 rejects a newly-created WriteStream whose asynchronous ``open``
  // event has not fired when it is passed as stdio. Opening the descriptor
  // first also makes first-workspace startup deterministic on slow filesystems.
  const log = await open(launch.logPath, 'a')
  try {
    const child = spawnProcess(
      launch.command,
      [...launch.args],
      {
        cwd: launch.cwd,
        env: launch.environment,
        detached: launch.detached,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', log.fd, log.fd]
      }
    )
    child.unref()
  } finally {
    // spawn duplicates/inherits the descriptor for the child.
    await log.close()
  }
}
