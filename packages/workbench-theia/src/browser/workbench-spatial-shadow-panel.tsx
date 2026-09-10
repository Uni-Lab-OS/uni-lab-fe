import type { FileService } from '@theia/filesystem/lib/browser/file-service'
import {
  SpatialShadowDiagnostics,
  SpatialShadowPlaybackProvider
} from '@unilab/spatial-diagnostics'
import { useState } from 'react'

import { useWorkbenchSpatialShadow } from './workbench-spatial-shadow-source'

/**
 * 物料（Material）视图中的只读空间影子（Spatial Shadow）入口。
 *
 * 该面板只读取工作区导出的快照，不修改物料状态、机器人遥测或执行命令。
 * 诊断内容保持在独立面板中，避免把影子证据误当成 3D 场景或放行结论。
 */
export function WorkbenchSpatialShadowPanel({
  fileService,
  workspacePath
}: {
  fileService: FileService
  workspacePath: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const spatialShadow = useWorkbenchSpatialShadow({
    reader: fileService,
    workspacePath,
    active: open,
    recoveryRevision: 0
  })

  return (
    <aside className="unilab-workbench-spatial-shadow-panel">
      <button
        className="unilab-workbench-spatial-shadow-panel__toggle"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        {open ? '关闭空间约束诊断' : '打开空间约束诊断'}
      </button>
      {open ? (
        <div className="unilab-workbench-spatial-shadow-panel__content">
          <SpatialShadowPlaybackProvider snapshot={spatialShadow.snapshot}>
            <SpatialShadowDiagnostics
              snapshot={spatialShadow.snapshot}
              status={spatialShadow.status}
              onReload={spatialShadow.reload}
            />
          </SpatialShadowPlaybackProvider>
        </div>
      ) : null}
    </aside>
  )
}
