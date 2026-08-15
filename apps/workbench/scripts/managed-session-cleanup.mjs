import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const SESSION_RELATIVE_PATH = path.join(
  '.unilabos',
  'runtime',
  'workbench',
  'session.json'
)

/** Resolve only processes recorded by the current Theia backend generation. */
export async function resolveManagedSessionProcessIds({
  workspacePath,
  launcherPid
}) {
  let manifest
  try {
    manifest = JSON.parse(await readFile(
      path.join(workspacePath, SESSION_RELATIVE_PATH),
      'utf8'
    ))
  } catch {
    return []
  }
  if (
    manifest?.schemaVersion !== 1
    || manifest?.launcherPid !== launcherPid
    || path.resolve(manifest?.identity?.workspacePath ?? '')
      !== path.resolve(workspacePath)
  ) {
    return []
  }
  return [
    manifest?.edgeRuntime?.pid,
    manifest?.plcSimulator?.pid,
    manifest?.agentRuntime?.pid,
    manifest?.identity?.pid
  ]
    .filter(pid => Number.isInteger(pid) && pid > 0)
    .filter((pid, index, values) => values.indexOf(pid) === index)
}

/** Bounded fallback cleanup for managed children when Theia exits abruptly. */
export async function stopManagedSessionProcesses({
  workspacePath,
  launcherPid,
  platform = process.platform
}) {
  const processIds = await resolveManagedSessionProcessIds({
    workspacePath,
    launcherPid
  })
  for (const pid of processIds) {
    await stopProcessTree(pid, platform)
  }
}

async function stopProcessTree(pid, platform) {
  if (!processExists(pid)) return
  if (platform === 'win32') {
    await new Promise(resolveStop => {
      const killer = spawn('taskkill.exe', [
        '/pid', String(pid), '/t', '/f'
      ], { windowsHide: true })
      killer.once('close', () => resolveStop())
      killer.once('error', () => resolveStop())
    })
    return
  }
  sendProcessGroupSignal(pid, 'SIGTERM')
  for (let attempt = 0; attempt < 20 && processExists(pid); attempt += 1) {
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
  }
  if (processExists(pid)) sendProcessGroupSignal(pid, 'SIGKILL')
}

function sendProcessGroupSignal(pid, signal) {
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      // The process exited between ownership validation and signalling.
    }
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
