import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { discoverWorkbenchPlcVariableTables } from './plc-variable-tables'

describe('Workspace PLC variable-table discovery', () => {
  it('recommends the table referenced by the selected device graph', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'unilab-plc-tables-'))
    const graphPath = join('deployment', 'graphs', 'szlab-local-debug.json')
    const tableDirectory = join(
      workspacePath,
      'szlab_poly_studio',
      'devices',
      'szlab_poly_plc'
    )
    await Promise.all([
      mkdir(join(workspacePath, 'deployment', 'graphs'), { recursive: true }),
      mkdir(tableDirectory, { recursive: true }),
      mkdir(join(workspacePath, 'reports'), { recursive: true })
    ])
    await Promise.all([
      writeFile(
        join(workspacePath, graphPath),
        JSON.stringify({ nodes: [{ config: { csv_path: 'szlab_plc_0807.csv' } }] })
      ),
      writeFile(join(tableDirectory, 'szlab_plc_0807.csv'), '变量名,数据类型\nA,BOOL\n'),
      writeFile(join(tableDirectory, 'szlab_plc_0810.csv'), '变量名,数据类型\nA,BOOL\n'),
      writeFile(join(workspacePath, 'reports', 'samples.csv'), 'sample,value\nA,1\n')
    ])

    const candidates = await discoverWorkbenchPlcVariableTables({
      workspacePath,
      graphPath
    })

    expect(candidates).toHaveLength(2)
    expect(candidates.find(candidate => candidate.recommended)).toMatchObject({
      name: 'szlab_plc_0807.csv',
      recommendation: 'device-graph'
    })
    expect(candidates.some(candidate => candidate.name === 'samples.csv')).toBe(false)
  })

  it('keeps an explicitly configured local CSV ahead of graph recommendations', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'unilab-plc-configured-'))
    const tableDirectory = join(workspacePath, 'devices', 'plc')
    await mkdir(tableDirectory, { recursive: true })
    const configuredPath = join(tableDirectory, 'variables_custom.csv')
    await writeFile(configuredPath, 'Name,DataType\nA,BOOLEAN\n')

    const candidates = await discoverWorkbenchPlcVariableTables({
      workspacePath,
      configuredPath
    })

    expect(candidates[0]).toMatchObject({
      path: await realpath(configuredPath),
      recommended: true,
      recommendation: 'configured'
    })
  })

  it('ignores tool caches while discovering PLC variable tables', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'unilab-plc-cache-'))
    const tableDirectory = join(workspacePath, 'devices', 'plc')
    const pytestCache = join(workspacePath, '.pytest_cache')
    await Promise.all([
      mkdir(tableDirectory, { recursive: true }),
      mkdir(pytestCache, { recursive: true })
    ])
    await Promise.all([
      writeFile(join(tableDirectory, 'variables.csv'), 'Name,DataType\nA,BOOLEAN\n'),
      writeFile(join(pytestCache, 'plc_cache.csv'), 'Name,DataType\nB,BOOLEAN\n')
    ])

    const candidates = await discoverWorkbenchPlcVariableTables({
      workspacePath
    })

    expect(candidates.map(candidate => candidate.name)).toEqual([
      'variables.csv'
    ])
  })
})
