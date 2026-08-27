import type {
  WorkflowActionCatalogSnapshot,
  WorkflowAuthoringGraph,
  WorkflowMaterialSourceCatalogSnapshot,
  WorkflowRuntimePort
} from '@unilab/services'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { projectMaterialSourceEditor } from '../utils/workflowMaterialSource'
import {
  errorMessage,
  isRecordValue,
  shortTemplateLabel
} from '../utils/persistentAuthoringProjection'

interface PersistentWorkflowCatalogOptions {
  runtime: WorkflowRuntimePort
  graph: WorkflowAuthoringGraph | null
}

const CATALOG_READ_RETRY_DELAY_MS = 250
const CATALOG_READ_RETRY_ATTEMPTS = 5
const ACTION_CATALOG_RETRY_DELAY_MS = 1_000

/**
 * 对只读目录做一次短暂重试，吸收本地 OS 重启和大量模板预取时的瞬时断连。
 *
 * @param read 无副作用的目录读取操作。
 * @returns 首次成功的目录快照。
 * @throws 五次读取均失败时抛出最后一次错误。
 */
async function readCatalogWithRetry<Value>(
  read: () => Promise<Value>
): Promise<Value> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < CATALOG_READ_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await read()
    } catch (error) {
      lastError = error
    }
    if (attempt === CATALOG_READ_RETRY_ATTEMPTS - 1) break
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, CATALOG_READ_RETRY_DELAY_MS)
    })
  }
  throw lastError
}

/**
 * 集中维护工作流（Workflow）动作目录与物料来源（MaterialSource）目录。
 *
 * @param options 运行端口、当前候选图和界面错误写入器。
 * @returns 目录快照、加载状态、刷新命令与物料来源权威门禁。
 */
export function usePersistentWorkflowCatalogs({
  runtime,
  graph
}: PersistentWorkflowCatalogOptions) {
  const [actionCatalog, setActionCatalog] =
    useState<WorkflowActionCatalogSnapshot | null>(null)
  const [actionCatalogError, setActionCatalogError] =
    useState<string | null>(null)
  const [materialSourceCatalog, setMaterialSourceCatalog] =
    useState<WorkflowMaterialSourceCatalogSnapshot | null>(null)
  const [materialSourceCatalogLoading, setMaterialSourceCatalogLoading] =
    useState(true)
  const [materialSourceCatalogError, setMaterialSourceCatalogError] =
    useState<string | null>(null)
  // 每次 runtime/backend 换代都使旧请求租约失效，禁止旧 OS 的迟到失败覆盖
  // 新 OS 已完成的目录状态。
  const catalogRequestGeneration = useRef(0)
  const actionCatalogRequestGeneration = useRef(0)

  /**
   * 重新读取物料来源（MaterialSource）目录，并保留失败关闭状态。
   *
   * @returns 目录刷新完成后的 Promise；错误通过目录状态呈现。
   */
  const refreshMaterialSourceCatalog = useCallback(async (): Promise<void> => {
    const requestGeneration = ++catalogRequestGeneration.current
    setMaterialSourceCatalogLoading(true)
    setMaterialSourceCatalogError(null)
    try {
      const catalog = await readCatalogWithRetry(
        () => runtime.getWorkflowMaterialSourceCatalog()
      )
      if (requestGeneration !== catalogRequestGeneration.current) return
      setMaterialSourceCatalog(catalog)
    } catch (catalogError) {
      if (requestGeneration !== catalogRequestGeneration.current) return
      setMaterialSourceCatalog(null)
      setMaterialSourceCatalogError(errorMessage(catalogError))
    } finally {
      if (requestGeneration === catalogRequestGeneration.current) {
        setMaterialSourceCatalogLoading(false)
      }
    }
  }, [runtime])

  /**
   * 在目录冲突后原子补读动作与物料来源（MaterialSource）目录。
   *
   * @returns 两份新目录快照；任一读取失败时抛出原始错误。
   */
  const refreshWorkflowCatalogsAfterConflict = useCallback(
    async (): Promise<{
      action: WorkflowActionCatalogSnapshot
      materialSource: WorkflowMaterialSourceCatalogSnapshot
    }> => {
      // 冲突补读同时接管两份目录的请求租约。否则它完成后，旧的后台预取仍
      // 可能迟到并把新目录覆盖成旧 OS 的快照。
      const materialSourceRequestGeneration =
        ++catalogRequestGeneration.current
      const actionRequestGeneration =
        ++actionCatalogRequestGeneration.current
      setActionCatalog(null)
      setActionCatalogError(null)
      setMaterialSourceCatalog(null)
      setMaterialSourceCatalogLoading(true)
      setMaterialSourceCatalogError(null)
      const [actionResult, materialSourceResult] = await Promise.allSettled([
        runtime.getWorkflowActionCatalog(),
        runtime.getWorkflowMaterialSourceCatalog()
      ])
      const actionRequestIsCurrent =
        actionRequestGeneration === actionCatalogRequestGeneration.current
      const materialSourceRequestIsCurrent =
        materialSourceRequestGeneration === catalogRequestGeneration.current
      if (actionRequestIsCurrent) {
        if (actionResult.status === 'fulfilled') {
          setActionCatalog(actionResult.value)
        } else {
          setActionCatalogError(
            `操作目录加载失败：${errorMessage(actionResult.reason)}`
          )
        }
      }
      if (materialSourceRequestIsCurrent) {
        if (materialSourceResult.status === 'fulfilled') {
          setMaterialSourceCatalog(materialSourceResult.value)
        } else {
          setMaterialSourceCatalogError(
            errorMessage(materialSourceResult.reason)
          )
        }
        setMaterialSourceCatalogLoading(false)
      }
      if (!actionRequestIsCurrent || !materialSourceRequestIsCurrent) {
        throw new Error('目录刷新已被较新的运行数据请求替代，请重试')
      }
      if (materialSourceResult.status === 'rejected') {
        throw materialSourceResult.reason
      }
      if (actionResult.status === 'rejected') throw actionResult.reason
      return {
        action: actionResult.value,
        materialSource: materialSourceResult.value
      }
    },
    [runtime]
  )

  useEffect(() => {
    void refreshMaterialSourceCatalog()
    return () => {
      catalogRequestGeneration.current += 1
    }
  }, [refreshMaterialSourceCatalog])

  useEffect(() => {
    if (
      materialSourceCatalogLoading ||
      materialSourceCatalogError ||
      !materialSourceCatalog
    ) return
    let active = true
    let retryTimer: ReturnType<typeof globalThis.setTimeout> | null = null
    const requestGeneration = ++actionCatalogRequestGeneration.current
    // MaterialSource 是运行准入门禁；先建立它，再预取体量更大的动作目录，
    // 避免两组跨端口请求在浏览器启动瞬间彼此挤占连接。
    const readActionCatalog = async (): Promise<void> => {
      setActionCatalogError(null)
      try {
        const catalog = await readCatalogWithRetry(
          () => runtime.getWorkflowActionCatalog()
        )
        if (
          !active ||
          requestGeneration !== actionCatalogRequestGeneration.current
        ) return
        setActionCatalog(catalog)
      } catch (catalogError) {
        if (
          !active ||
          requestGeneration !== actionCatalogRequestGeneration.current
        ) return
        setActionCatalog(null)
        setActionCatalogError(
          `操作目录加载失败：${errorMessage(catalogError)}`
        )
        retryTimer = globalThis.setTimeout(() => {
          void readActionCatalog()
        }, ACTION_CATALOG_RETRY_DELAY_MS)
      }
    }
    void readActionCatalog()
    return () => {
      active = false
      actionCatalogRequestGeneration.current += 1
      if (retryTimer !== null) globalThis.clearTimeout(retryTimer)
    }
  }, [
    materialSourceCatalog,
    materialSourceCatalogError,
    materialSourceCatalogLoading,
    runtime
  ])

  const effectiveMaterialSourceCatalog = useMemo(() => {
    if (!materialSourceCatalog) return null
    const templatesByUuid = new Map(
      materialSourceCatalog.resourceTemplates.map((template) => [
        template.uuid,
        template
      ])
    )
    for (const node of graph?.nodes ?? []) {
      if (node.type !== 'material_source' || !isRecordValue(node.param)) {
        continue
      }
      const templateUuid = node.param.resource_template_uuid
      if (typeof templateUuid !== 'string' || !templateUuid) continue
      templatesByUuid.set(
        templateUuid,
        templatesByUuid.get(templateUuid) ?? {
          uuid: templateUuid,
          displayName: shortTemplateLabel(templateUuid)
        }
      )
    }
    for (const template of [
      ...(actionCatalog?.actionTemplates ?? []),
      ...(actionCatalog?.workflowTemplates ?? [])
    ]) {
      for (const handle of template.handles) {
        for (const templateUuid of handle.allowedResourceTemplateUuids ?? []) {
          templatesByUuid.set(
            templateUuid,
            templatesByUuid.get(templateUuid) ?? {
              uuid: templateUuid,
              displayName: shortTemplateLabel(templateUuid)
            }
          )
        }
      }
    }
    return {
      ...materialSourceCatalog,
      resourceTemplates: [...templatesByUuid.values()]
        .sort((left, right) => left.uuid.localeCompare(right.uuid))
    }
  }, [actionCatalog, graph, materialSourceCatalog])

  const materialSourceAuthorityBlocked = useMemo(() => {
    const sourceNodes = graph?.nodes.filter(
      (node) => node.type === 'material_source'
    ) ?? []
    if (sourceNodes.length === 0) return false
    if (
      materialSourceCatalogLoading ||
      materialSourceCatalogError ||
      !effectiveMaterialSourceCatalog ||
      !graph
    ) return true
    return sourceNodes.some((node) => {
      if (typeof node.uuid !== 'string' || !node.uuid) return true
      try {
        return projectMaterialSourceEditor(
          effectiveMaterialSourceCatalog,
          graph,
          node.uuid
        ).staleReferences.length > 0
      } catch {
        return true
      }
    })
  }, [
    effectiveMaterialSourceCatalog,
    graph,
    materialSourceCatalogError,
    materialSourceCatalogLoading
  ])

  return {
    actionCatalog,
    actionCatalogError,
    effectiveMaterialSourceCatalog,
    materialSourceAuthorityBlocked,
    materialSourceCatalog,
    materialSourceCatalogError,
    materialSourceCatalogLoading,
    refreshMaterialSourceCatalog,
    refreshWorkflowCatalogsAfterConflict
  }
}
