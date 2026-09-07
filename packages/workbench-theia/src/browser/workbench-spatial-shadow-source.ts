import { URI } from '@theia/core/lib/common/uri'
import type { FileService } from '@theia/filesystem/lib/browser/file-service'
import {
  parseSpatialShadowSnapshot,
  type SpatialDiagnosticsStatus,
  type SpatialShadowSnapshot
} from '@unilab/spatial-diagnostics'
import { useCallback, useEffect, useState } from 'react'

export const WORKBENCH_SPATIAL_SHADOW_PATH =
  '.unilab/spatial-shadow/current.v0.json'

type SpatialShadowReader = Pick<FileService, 'read'>

/** 把当前 workspace 映射到唯一允许读取的空间 Shadow 相对路径。 */
export function workbenchSpatialShadowUri(workspacePath: string): URI {
  if (!workspacePath.trim()) {
    throw new Error('Workbench 尚未提供当前 workspace 路径')
  }
  return URI.fromFilePath(workspacePath).resolve(WORKBENCH_SPATIAL_SHADOW_PATH)
}

/** 从当前 Theia workspace 的固定只读路径加载并校验空间 Shadow 快照。 */
export async function loadWorkbenchSpatialShadow(
  reader: SpatialShadowReader,
  workspacePath: string
): Promise<SpatialShadowSnapshot> {
  const resource = workbenchSpatialShadowUri(workspacePath)
  const content = await reader.read(resource)
  try {
    return parseSpatialShadowSnapshot(content.value)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`空间 Shadow 快照校验失败：${message}`)
  }
}

/** 在空间审阅器或物料 3D 需要叠加时读取；失败时不提供演示回退。 */
export function useWorkbenchSpatialShadow({
  reader,
  workspacePath,
  active,
  recoveryRevision
}: {
  reader: SpatialShadowReader
  workspacePath: string
  active: boolean
  recoveryRevision: number
}): {
  snapshot: SpatialShadowSnapshot | null
  status: SpatialDiagnosticsStatus
  reload: () => void
} {
  const [revision, setRevision] = useState(0)
  const [snapshot, setSnapshot] = useState<SpatialShadowSnapshot | null>(null)
  const [status, setStatus] = useState<SpatialDiagnosticsStatus>({
    phase: 'loading',
    message: '等待打开空间约束审阅器…'
  })
  const reload = useCallback(() => setRevision(value => value + 1), [])

  useEffect(() => {
    if (!active) return
    if (!workspacePath.trim()) {
      setSnapshot(null)
      setStatus({
        phase: 'unavailable',
        message: '当前 Workbench 没有已激活的 workspace。'
      })
      return
    }
    let cancelled = false
    setStatus({
      phase: 'loading',
      message: '正在读取并校验 EIT 空间 Shadow 快照…'
    })
    void loadWorkbenchSpatialShadow(reader, workspacePath).then(
      value => {
        if (cancelled) return
        setSnapshot(value)
        setStatus({
          phase: 'ready',
          message: `已读取 ${WORKBENCH_SPATIAL_SHADOW_PATH}`
        })
      },
      cause => {
        if (cancelled) return
        setSnapshot(null)
        const message = cause instanceof Error ? cause.message : String(cause)
        setStatus({
          phase: 'error',
          message: `${message}。先运行 EIT 编译与 Workbench 导出命令，再重新读取。`
        })
      }
    )
    return () => {
      cancelled = true
    }
  }, [active, reader, recoveryRevision, revision, workspacePath])

  return { snapshot, status, reload }
}
