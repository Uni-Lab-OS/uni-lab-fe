import type { Services, WorkflowTaskExecutionLocks } from '@unilab/services'
import type {
  WorkflowEnvironmentResetPort,
  WorkflowEnvironmentResetResult
} from '@unilab/workflow-editor'

/** 组合三个明确的复位操作；预览不写入，执行不隐式更新冲突版本。 */
export function createWorkbenchEnvironmentReset(
  services: Services,
  canRebuild: boolean,
  rebuild: () => Promise<void>,
  refreshMaterialGraph: () => Promise<void>
): WorkflowEnvironmentResetPort {
  return {
    available: {
      rebuild: canRebuild,
      materials: Boolean(services.materials.resetLocations),
      locks: Boolean(services.workflow.executionLocks && services.capabilities.workflow.releaseTaskResources)
    },
    async preview(selection) {
      if (selection.rebuild) {
        if (!canRebuild) throw new Error('当前连接不能重建本地数据')
        return {
          selection,
          summary: ['停止本地服务，清空本地库存、设备状态、工作流历史及恢复协议状态，再重新启动。'],
          execute: async (_reason, signal) => {
            try {
              signal?.throwIfAborted()
              await rebuild()
              return [{ operation: '重建本地数据', status: 'completed', message: '本地数据已重建，物料和锁已随之复位。' }]
            } catch (error) {
              return [{ operation: '重建本地数据', status: 'failed', message: message(error) }]
            }
          }
        }
      }
      const materialPort = services.materials.resetLocations
      const lockPort = services.workflow.executionLocks
      if (selection.materials && !materialPort) throw new Error('当前连接不支持物料位置复位')
      if (selection.locks && !lockPort) throw new Error('当前连接不支持设备锁复位')
      const materialPreview = selection.materials ? await materialPort!.preview() : null
      const graph = materialPreview ? await services.materials.getGraph({ kind: 'singleton' }) : []
      const materialNames = new Map(graph.map(row => [row.material.id, row.material.name]))
      const siteNames = new Map(graph.flatMap(row => row.sites.map(site => [site.id, `${row.material.name} / ${site.name || site.key}`] as const)))
      const owners: WorkflowTaskExecutionLocks[] = []
      if (selection.locks) {
        let page = 1
        let read = 0
        while (true) {
          const tasks = await (services.workflow.listWorkflowTaskPresentations ?? services.workflow.listWorkflowTasks)({ page, page_size: 100 })
          for (const task of tasks.items) {
            if (task.cleanup_status === 'settled') continue
            const locks = await lockPort!.list(task.uuid)
            if (locks.locks.length || locks.active_device_tenancy_count) owners.push(locks)
          }
          read += tasks.items.length
          if (read >= tasks.total) break
          if (!tasks.items.length) throw new Error('任务目录不完整，请重新预览')
          page += 1
        }
      }
      const eligible = owners.filter(owner => ['failed', 'canceled', 'timeout'].includes(owner.task_status))
      const keys = new Map(eligible.map(owner => [owner.workflow_task_uuid, crypto.randomUUID()]))
      const summary: string[] = []
      if (selection.locks) {
        summary.push(`解除 ${eligible.length} 个异常终态任务的全部资源锁；${owners.length - eligible.length} 个其他任务不在解除范围内。`)
        summary.push(...eligible.map(owner => `任务 ${owner.workflow_task_uuid}：${owner.locks.length} 项执行锁、${owner.active_device_tenancy_count} 项设备托管。`))
      }
      if (materialPreview) {
        summary.push(`恢复启动设备图中的物料位置，${materialPreview.materials.filter(row => row.needs_reset && row.reset_kind === 'baseline').length} 项位置需要更新。不改变物料数量或内容。`)
        summary.push("保留运行期间新建物料，将 " + materialPreview.materials.filter(row => row.needs_reset && row.reset_kind === 'unplace_new').length + " 项移到未放置；不会删除其身份或内容。")
        summary.push(...materialPreview.materials.filter(row => row.needs_reset).map(row =>
          `${row.name} → ${row.reset_kind === 'unplace_new' ? '未放置（新建物料保留）' : row.site_uuid ? siteNames.get(row.site_uuid) ?? '库位 ' + row.site_uuid.slice(0, 8) : row.parent_uuid ? materialNames.get(row.parent_uuid) ?? '父物料 ' + row.parent_uuid.slice(0, 8) : '启动图中的世界位置'}`))
      }
      return {
        selection,
        summary,
        async execute(reason, signal) {
          const results: WorkflowEnvironmentResetResult[] = []
          if (selection.locks) {
            for (const owner of eligible) {
              try {
                signal?.throwIfAborted()
                const command = await lockPort!.unlockResources(owner.workflow_task_uuid, {
                  idempotency_key: keys.get(owner.workflow_task_uuid)!, reason, physical_safe_confirmed: true
                })
                const current = await lockPort!.list(owner.workflow_task_uuid)
                if (command.status !== 'succeeded' || current.locks.length || current.active_device_tenancy_count) {
                  throw new Error(typeof command.result?.reason === 'string' ? command.result.reason : '任务资源尚未确认全部释放，请重新核对')
                }
                results.push({ operation: `设备锁 · ${owner.workflow_task_uuid}`, status: 'completed', message: '该任务资源锁已确认释放' })
              } catch (error) {
                results.push({ operation: `设备锁 · ${owner.workflow_task_uuid}`, status: 'failed', message: message(error) })
                if (selection.materials) results.push({ operation: '复位物料', status: 'skipped', message: '前一项解锁未完成，未修改物料位置。' })
                return results
              }
            }
            if (!eligible.length) results.push({ operation: '复位设备锁', status: 'completed', message: '没有符合条件的异常终态任务资源锁。' })
            if (owners.length > eligible.length) results.push({ operation: '其他任务资源锁', status: 'skipped', message: `${owners.length - eligible.length} 个运行中或其他状态任务的资源锁未解除。` })
          }
          if (materialPreview) {
            try {
              signal?.throwIfAborted()
              const result = await materialPort!.apply({
                baseline_fingerprint: materialPreview.baseline_fingerprint,
                expected_revisions: Object.fromEntries(materialPreview.materials.map(row => [row.material_uuid, row.revision])),
                physical_settlement_confirmed: true
              })
              if (result.status !== 'restored') throw new Error('服务未确认位置已恢复')
              results.push({ operation: '复位物料', status: 'completed', message: `已恢复 ${result.restored_count} 项物料位置。` })
              try { await refreshMaterialGraph() }
              catch (error) { results.push({ operation: '刷新物料视图', status: 'failed', message: message(error) }) }
            } catch (error) {
              results.push({ operation: '复位物料', status: 'failed', message: message(error) + '；请核对当前状态后重新预览，不会自动重试。' })
            }
          }
          return results
        }
      }
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
