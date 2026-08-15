import { constants as fsConstants } from 'node:fs'
import { access, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

export const WORKBENCH_LAUNCH_CONFIG_VERSION = 2
export const MAX_RECENT_WORKSPACES = 8

export function normalizeWorkbenchLaunchConfig(value) {
  if (!value || typeof value !== 'object') return emptyConfig()
  if (value.version === WORKBENCH_LAUNCH_CONFIG_VERSION) {
    return {
      version: WORKBENCH_LAUNCH_CONFIG_VERSION,
      recentWorkspaces: Array.isArray(value.recentWorkspaces)
        ? value.recentWorkspaces
            .map(normalizeRecentWorkspace)
            .filter(Boolean)
            .slice(0, MAX_RECENT_WORKSPACES)
        : []
    }
  }
  if (value.version === 1 && nonEmptyString(value.workspace)) {
    return {
      version: WORKBENCH_LAUNCH_CONFIG_VERSION,
      recentWorkspaces: [{
        path: value.workspace,
        pythonEnvironment: optionalString(value.pythonEnvironment),
        osProject: optionalString(value.osProject),
        lastOpenedAt: new Date(0).toISOString()
      }]
    }
  }
  return emptyConfig()
}

export function recordRecentWorkspace(config, entry) {
  const normalized = normalizeRecentWorkspace(entry)
  if (!normalized) throw new Error('最近工作区记录无效')
  return {
    version: WORKBENCH_LAUNCH_CONFIG_VERSION,
    recentWorkspaces: [
      normalized,
      ...normalizeWorkbenchLaunchConfig(config).recentWorkspaces.filter(
        candidate => candidate.path !== normalized.path
      )
    ].slice(0, MAX_RECENT_WORKSPACES)
  }
}

export function recentWorkspaceForPath(config, workspacePath) {
  return normalizeWorkbenchLaunchConfig(config).recentWorkspaces.find(
    entry => entry.path === workspacePath
  ) ?? null
}

/**
 * Reject a folder that can be opened by Theia but cannot launch UniLab OS.
 * The device graph is a launch input inside a Workspace; selecting one must
 * never silently turn a parent folder into the domain Workspace.
 */
export async function requireWorkbenchWorkspace(workspacePath) {
  const localConfigPath = path.join(
    workspacePath,
    'deployment',
    'local_config.py'
  )
  if (await readableFile(localConfigPath)) return workspacePath

  const candidates = await immediateWorkspaceCandidates(workspacePath)
  const suggestion = candidates.length === 1
    ? `请选择检测到的工作区：${candidates[0]}`
    : candidates.length > 1
      ? `请选择其中一个有效工作区：${candidates.join('、')}`
      : '请选择包含 deployment/local_config.py 的领域项目根目录。'
  throw new Error([
    `所选目录不是有效的 UniLab Workspace：${workspacePath}`,
    '缺少 deployment/local_config.py。设备图路径只决定 OS 加载哪个图，不会改变 Workspace。',
    suggestion
  ].join('\n'))
}

function normalizeRecentWorkspace(value) {
  if (!value || typeof value !== 'object' || !nonEmptyString(value.path)) {
    return null
  }
  const lastOpenedAt = nonEmptyString(value.lastOpenedAt)
    && Number.isFinite(Date.parse(value.lastOpenedAt))
    ? new Date(value.lastOpenedAt).toISOString()
    : new Date(0).toISOString()
  return {
    path: value.path,
    pythonEnvironment: optionalString(value.pythonEnvironment),
    osProject: optionalString(value.osProject),
    lastOpenedAt
  }
}

function emptyConfig() {
  return {
    version: WORKBENCH_LAUNCH_CONFIG_VERSION,
    recentWorkspaces: []
  }
}

function optionalString(value) {
  return nonEmptyString(value) ? value : null
}

function nonEmptyString(value) {
  return typeof value === 'string' && Boolean(value.trim())
}

async function immediateWorkspaceCandidates(workspacePath) {
  try {
    const entries = await readdir(workspacePath, { withFileTypes: true })
    const candidates = await Promise.all(entries
      .filter(entry => entry.isDirectory())
      .map(async entry => {
        const candidate = path.join(workspacePath, entry.name)
        return await readableFile(path.join(
          candidate,
          'deployment',
          'local_config.py'
        )) ? candidate : null
      }))
    return candidates.filter(Boolean)
  } catch {
    return []
  }
}

async function readableFile(filePath) {
  try {
    await access(filePath, fsConstants.R_OK)
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}
