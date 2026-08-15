import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  MANAGED_WORKSPACE_SKILL_NAMES,
  resolveManagedWorkspaceSkillSource,
  seedManagedWorkspaceSkills
} from './workspace-skills'

const fixtureRoots: string[] = []

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map(root => rm(root, {
    recursive: true,
    force: true
  })))
})

describe('managed Workspace skills', () => {
  it('installs the complete allowlist and resolves explicit sources', async () => {
    const fixture = await createFixture()
    expect(resolveManagedWorkspaceSkillSource({
      UNILAB_WORKBENCH_SKILLS: fixture.sourcePath
    }, fixture.root)).toBe(fixture.sourcePath)

    const results = await seedManagedWorkspaceSkills({
      workspacePath: fixture.workspacePath,
      sourceDirectory: fixture.sourcePath
    })

    expect(results.map(result => [result.name, result.status])).toEqual(
      MANAGED_WORKSPACE_SKILL_NAMES.map(name => [name, 'installed'])
    )
    await expect(readFile(join(
      fixture.workspacePath,
      '.agents',
      'skills',
      'create-device-skill',
      'scripts',
      'helper.py'
    ), 'utf8')).resolves.toBe('print("helper")\n')
  })

  it('updates untouched managed skills and preserves user-owned changes', async () => {
    const fixture = await createFixture()
    await seedManagedWorkspaceSkills({
      workspacePath: fixture.workspacePath,
      sourceDirectory: fixture.sourcePath
    })
    const managedSkill = MANAGED_WORKSPACE_SKILL_NAMES[0]
    const customizedSkill = MANAGED_WORKSPACE_SKILL_NAMES[1]
    await writeFile(join(
      fixture.workspacePath,
      '.agents',
      'skills',
      customizedSkill,
      'notes.md'
    ), 'user-owned\n')
    await writeFile(join(
      fixture.sourcePath,
      managedSkill,
      'version.md'
    ), 'version 2\n')
    await writeFile(join(
      fixture.sourcePath,
      customizedSkill,
      'version.md'
    ), 'version 2\n')

    const results = await seedManagedWorkspaceSkills({
      workspacePath: fixture.workspacePath,
      sourceDirectory: fixture.sourcePath
    })

    expect(results.find(result => result.name === managedSkill)?.status)
      .toBe('updated')
    expect(results.find(result => result.name === customizedSkill)?.status)
      .toBe('preserved')
    await expect(readFile(join(
      fixture.workspacePath,
      '.agents',
      'skills',
      customizedSkill,
      'notes.md'
    ), 'utf8')).resolves.toBe('user-owned\n')
  })

  it('prefers a complete bundled payload over an incomplete OS skill set', async () => {
    const fixture = await createFixture()
    const bundledSource = join(fixture.root, 'resources', 'workspace-skills')
    const osProject = join(fixture.root, 'os-project')
    const osSkills = join(osProject, '.cursor', 'skills')
    await cp(fixture.sourcePath, bundledSource, { recursive: true })
    await mkdir(join(osSkills, 'add-device'), { recursive: true })
    await writeFile(join(osSkills, 'add-device', 'SKILL.md'), [
      '---',
      'name: add-device',
      'description: incomplete legacy payload',
      '---',
      ''
    ].join('\n'))

    expect(resolveManagedWorkspaceSkillSource({
      UNILAB_OS_PROJECT: osProject
    }, fixture.root)).toBe(bundledSource)
  })
})

async function createFixture(): Promise<{
  root: string
  sourcePath: string
  workspacePath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'unilab-workspace-skills-'))
  fixtureRoots.push(root)
  const sourcePath = join(root, 'source')
  const workspacePath = join(root, 'workspace')
  await Promise.all([
    mkdir(sourcePath, { recursive: true }),
    mkdir(workspacePath, { recursive: true })
  ])
  await Promise.all(MANAGED_WORKSPACE_SKILL_NAMES.map(async name => {
    const skillPath = join(sourcePath, name)
    await mkdir(skillPath, { recursive: true })
    await writeFile(join(skillPath, 'SKILL.md'), [
      '---',
      `name: ${name}`,
      'description: fixture',
      '---',
      '',
      `# ${name}`,
      ''
    ].join('\n'))
    if (name === 'create-device-skill') {
      await mkdir(join(skillPath, 'scripts'), { recursive: true })
      await writeFile(join(skillPath, 'scripts', 'helper.py'),
        'print("helper")\n')
    }
  }))
  return { root, sourcePath, workspacePath }
}
