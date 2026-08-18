import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

let workbenchSource = ''

beforeAll(async () => {
  workbenchSource = await readFile(fileURLToPath(new URL(
    './unilab-workbench-widget.tsx',
    import.meta.url
  )), 'utf8')
})

describe('Theia 工作流源码同步身份', () => {
  /** 从目录打开的工作流也必须成为 IDE 保存回写目标，不能只认 URL 参数。 */
  it('uses the active catalog workflow when saved source changes', () => {
    expect(workbenchSource).toMatch(
      /const \[activeWorkflowUuid, setActiveWorkflowUuid\][\s\S]*?useState/u
    )
    expect(workbenchSource).toContain(
      'onActiveWorkflowChange={setActiveWorkflowUuid}'
    )
    expect(workbenchSource).toMatch(
      /synchronizeSavedWorkflowSource\(\s*services\.workflow,\s*activeWorkflowUuid,/u
    )
  })

  /** 本地 Workbench 始终使用 Theia 文件编辑器，不能因缺少 Electron preload 回退。 */
  it('uses the Workbench IDE editor for local workflow source', () => {
    expect(workbenchSource).toContain(
      "hideEmbeddedCodeEditor={connectionMode === 'local'}"
    )
    expect(workbenchSource).not.toMatch(
      /hideEmbeddedCodeEditor=\{[\s\S]*?desktopWorkspaceApi\(\)/u
    )
  })
})
