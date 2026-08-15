import { createHash, randomUUID } from 'node:crypto'
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const MANAGED_WORKSPACE_SKILL_NAMES = [
  'add-device',
  'add-resource',
  'add-workstation',
  'create-device-package',
  'create-device-skill',
  'unilab-domain-repo-builder'
] as const

export type ManagedWorkspaceSkillName =
  typeof MANAGED_WORKSPACE_SKILL_NAMES[number]

export interface ManagedWorkspaceSkillResult {
  name: ManagedWorkspaceSkillName
  status: 'installed' | 'updated' | 'unchanged' | 'preserved'
  digest: string
}

interface ManagedWorkspaceSkillState {
  schemaVersion: 1
  skills: Partial<Record<ManagedWorkspaceSkillName, { digest: string }>>
}

const EMPTY_STATE: ManagedWorkspaceSkillState = {
  schemaVersion: 1,
  skills: {}
}

/** Resolve the canonical skill payload without assuming an OS sibling checkout. */
export function resolveManagedWorkspaceSkillSource(
  environment: NodeJS.ProcessEnv = process.env,
  currentDirectory: string = process.cwd()
): string | null {
  const explicit = environment['UNILAB_WORKBENCH_SKILLS']?.trim()
  if (explicit) return resolve(explicit)

  const bundledDevelopmentSkills = join(
    resolve(currentDirectory),
    'resources',
    'workspace-skills'
  )
  if (isCompleteManagedWorkspaceSkillSource(bundledDevelopmentSkills)) {
    return bundledDevelopmentSkills
  }

  const osProject = environment['UNILAB_OS_PROJECT']?.trim()
  if (osProject) {
    const osSkills = join(resolve(osProject), '.cursor', 'skills')
    if (isCompleteManagedWorkspaceSkillSource(osSkills)) return osSkills
  }

  return null
}

function isCompleteManagedWorkspaceSkillSource(sourceDirectory: string): boolean {
  return MANAGED_WORKSPACE_SKILL_NAMES.every(name =>
    existsSync(join(sourceDirectory, name, 'SKILL.md'))
  )
}

/**
 * Install the managed UniLab skill set into one Workspace.
 *
 * A previously seeded, untouched skill is upgraded when the bundled source
 * changes. Pre-existing or user-modified skill directories are preserved.
 */
export async function seedManagedWorkspaceSkills(options: {
  workspacePath: string
  sourceDirectory: string
}): Promise<readonly ManagedWorkspaceSkillResult[]> {
  const workspacePath = await realpath(options.workspacePath)
  const sourceDirectory = await realpath(options.sourceDirectory)
  const destinationRoot = join(workspacePath, '.agents', 'skills')
  const stateDirectory = join(workspacePath, '.unilabos', 'agent')
  const statePath = join(stateDirectory, 'managed-workspace-skills.json')
  const sourceSkills = await Promise.all(
    MANAGED_WORKSPACE_SKILL_NAMES.map(async name => {
      const sourcePath = join(sourceDirectory, name)
      await assertSkillDirectory(sourcePath, name)
      return { name, sourcePath, digest: await digestDirectory(sourcePath) }
    })
  )

  await Promise.all([
    mkdir(destinationRoot, { recursive: true }),
    mkdir(stateDirectory, { recursive: true })
  ])
  const state = await readManagedSkillState(statePath)
  const nextState: ManagedWorkspaceSkillState = {
    schemaVersion: 1,
    skills: { ...state.skills }
  }
  const results: ManagedWorkspaceSkillResult[] = []

  for (const sourceSkill of sourceSkills) {
    const destinationPath = join(destinationRoot, sourceSkill.name)
    if (!existsSync(destinationPath)) {
      await replaceSkillDirectory(sourceSkill.sourcePath, destinationPath)
      nextState.skills[sourceSkill.name] = { digest: sourceSkill.digest }
      results.push({
        name: sourceSkill.name,
        status: 'installed',
        digest: sourceSkill.digest
      })
      continue
    }

    const destinationDigest = await digestDirectory(destinationPath)
    if (destinationDigest === sourceSkill.digest) {
      nextState.skills[sourceSkill.name] = { digest: sourceSkill.digest }
      results.push({
        name: sourceSkill.name,
        status: 'unchanged',
        digest: sourceSkill.digest
      })
      continue
    }

    const previouslyManagedDigest = state.skills[sourceSkill.name]?.digest
    if (previouslyManagedDigest === destinationDigest) {
      await replaceSkillDirectory(sourceSkill.sourcePath, destinationPath)
      nextState.skills[sourceSkill.name] = { digest: sourceSkill.digest }
      results.push({
        name: sourceSkill.name,
        status: 'updated',
        digest: sourceSkill.digest
      })
      continue
    }

    results.push({
      name: sourceSkill.name,
      status: 'preserved',
      digest: destinationDigest
    })
  }

  await writeFile(statePath, `${JSON.stringify(nextState, null, 2)}\n`, {
    mode: 0o600
  })
  return results
}

async function assertSkillDirectory(
  sourcePath: string,
  expectedName: ManagedWorkspaceSkillName
): Promise<void> {
  let skillDocument: string
  try {
    const directory = await lstat(sourcePath)
    if (!directory.isDirectory()) throw new Error('not a directory')
    skillDocument = await readFile(join(sourcePath, 'SKILL.md'), 'utf8')
  } catch (error) {
    throw new Error(`UniLab 托管技能缺失：${expectedName}`, { cause: error })
  }
  const declaredName = skillDocument.match(
    /^---\s*$[\s\S]*?^name:\s*([^\s]+)\s*$/mu
  )?.[1]
  if (declaredName !== expectedName) {
    throw new Error(
      `UniLab 托管技能名称不匹配：期望 ${expectedName}，实际 ${declaredName ?? '未声明'}`
    )
  }
}

async function readManagedSkillState(
  statePath: string
): Promise<ManagedWorkspaceSkillState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(statePath, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return EMPTY_STATE
    const record = parsed as Record<string, unknown>
    if (record['schemaVersion'] !== 1 || !record['skills'] ||
      typeof record['skills'] !== 'object') return EMPTY_STATE
    return parsed as ManagedWorkspaceSkillState
  } catch {
    return EMPTY_STATE
  }
}

async function replaceSkillDirectory(
  sourcePath: string,
  destinationPath: string
): Promise<void> {
  const stagingRoot = join(
    resolve(destinationPath, '..', '..', '..'),
    '.unilabos',
    'agent',
    'skill-staging',
    randomUUID()
  )
  const stagedSkill = join(stagingRoot, 'skill')
  const backupSkill = join(stagingRoot, 'previous')
  await mkdir(stagingRoot, { recursive: true })
  try {
    await cp(sourcePath, stagedSkill, {
      recursive: true,
      dereference: true,
      preserveTimestamps: false
    })
    if (existsSync(destinationPath)) {
      await rename(destinationPath, backupSkill)
      try {
        await rename(stagedSkill, destinationPath)
      } catch (error) {
        await rename(backupSkill, destinationPath)
        throw error
      }
    } else {
      await rename(stagedSkill, destinationPath)
    }
  } finally {
    await rm(stagingRoot, { recursive: true, force: true })
  }
}

async function digestDirectory(root: string): Promise<string> {
  const hash = createHash('sha256')
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const entryPath = join(directory, entry.name)
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        hash.update(`directory\0${relativePath}\0`)
        await visit(entryPath, relativePath)
      } else if (entry.isFile()) {
        hash.update(`file\0${relativePath}\0`)
        hash.update(await readFile(entryPath))
      } else if (entry.isSymbolicLink()) {
        hash.update(`symlink\0${relativePath}\0${await readlink(entryPath)}\0`)
      } else {
        throw new Error(`UniLab 托管技能包含不支持的文件：${entryPath}`)
      }
    }
  }
  await visit(root, '')
  return hash.digest('hex')
}
