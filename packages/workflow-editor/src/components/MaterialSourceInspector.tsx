import type { WorkflowAuthoringDiagnostic } from '@unilab/services'
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties
} from 'react'

import {
  type MaterialSourceEditorProjection,
  type MaterialSourceSelectorUpdate
} from '../utils/workflowMaterialSource'
import { materialTraceAccent } from '../utils/workflowMaterialTrace'
import { WorkflowButton } from './WorkflowButton'
import { WorkflowResourceSelector } from './WorkflowResourceSelector'
import { workflowNodeStateLabel } from './WorkflowNodeCard'
import { workflowResourceSlotOptionLabel } from '../utils/workflowResourceSlotOptions'

export interface MaterialSourceInspectorProps {
  editor: MaterialSourceEditorProjection
  accent?: string
  editable: boolean
  status: string
  diagnostics: readonly WorkflowAuthoringDiagnostic[]
  onChange: (patch: Partial<MaterialSourceSelectorUpdate>) => void
  onRevealSource?: (sourceUri: string) => void
}

/**
 * 展示并编辑物料来源（MaterialSource）的闭集选择器。
 *
 * 组件只产生选择器补丁，不读取或写入物料权威事实。
 */
export function MaterialSourceInspector({
  editor,
  accent,
  editable,
  status,
  diagnostics,
  onChange,
  onRevealSource
}: MaterialSourceInspectorProps): React.JSX.Element {
  const resolvedAccent = accent ?? materialTraceAccent(editor.nodeUuid)
  const [siteQuery, setSiteQuery] = useState('')
  const visibleSites = useMemo(
    () => filterMaterialSourceSites(editor.sites, siteQuery),
    [editor.sites, siteQuery]
  )
  const selectedResourceTemplate = editor.resourceTemplates.find(
    template => template.uuid === editor.resourceTemplateUuid
  )
  useEffect(() => setSiteQuery(''), [editor.nodeUuid])
  return (
    <section
      className="persistent-authoring__material-source-inspector"
      aria-label="物料来源属性"
      data-material-source-node-uuid={editor.nodeUuid}
      style={{ '--wf-material-accent': resolvedAccent } as CSSProperties}
    >
      <div className="persistent-authoring__material-identity">
        <span className="persistent-authoring__material-hex" aria-hidden="true">
          ▱
        </span>
        <span>
          <strong>{editor.name}</strong>
          <small>
            {materialFlowRoleLabel(editor.flowRole)} · {' '}
            {editor.nodeUuid.replace(/-/g, '').slice(-6)}
          </small>
        </span>
        <span className="persistent-authoring__material-status">
          {workflowNodeStateLabel('material_source', status)}
        </span>
      </div>

      <fieldset>
        <legend>物料</legend>
        <label>
          物料角色
          <select
            aria-label="物料角色"
            value={editor.flowRole}
            disabled={!editable}
            onChange={(event) => onChange({
              flowRole: event.target.value as MaterialSourceSelectorUpdate['flowRole']
            })}
          >
            <option value="primary_sample">主样品</option>
            <option value="aliquot_sample">分装样品</option>
            <option value="reagent">试剂</option>
            <option value="consumable">耗材</option>
          </select>
        </label>
        <label>
          保管策略
          <select
            aria-label="保管策略"
            value={editor.custodyPolicy}
            disabled={!editable}
            onChange={(event) => onChange({
              custodyPolicy: event.target.value as
                MaterialSourceSelectorUpdate['custodyPolicy']
            })}
          >
            <option value="task_exclusive">任务全程独占</option>
            <option value="shared_source">动作期间共享</option>
          </select>
        </label>
        <label>
          资源模板
          <select
            aria-label="资源模板"
            value={editor.resourceTemplateUuid}
            disabled={!editable}
            onChange={(event) => onChange({
              resourceTemplateUuid: event.target.value
            })}
          >
            {editor.resourceTemplates.map((template) => (
              <option
                key={template.uuid}
                value={template.uuid}
                title={template.uuid}
              >
                {template.displayName}
              </option>
            ))}
          </select>
        </label>
        {selectedResourceTemplate?.sourceUri && onRevealSource ? (
          <WorkflowButton
            type="button"
            disabledReason="资源模板没有可导航的 Package 源码身份"
            onClick={() => onRevealSource(selectedResourceTemplate.sourceUri!)}
          >
            在代码中打开资源模板
          </WorkflowButton>
        ) : null}
      </fieldset>

      <fieldset>
        <legend>来源</legend>
        <div
          className="persistent-authoring__segmented"
          role="group"
          aria-label="取得方式"
        >
          <WorkflowButton
            type="button"
            className={editor.mode === 'existing' ? 'is-active' : ''}
            aria-pressed={editor.mode === 'existing'}
            disabled={!editable}
            disabledReason="当前模式只允许查看物料来源"
            onClick={() => onChange({ mode: 'existing' })}
          >
            已有物料
          </WorkflowButton>
          <WorkflowButton
            type="button"
            className={editor.mode === 'create_new' ? 'is-active' : ''}
            aria-pressed={editor.mode === 'create_new'}
            disabled={!editable}
            disabledReason="当前模式只允许查看物料来源"
            onClick={() => onChange({ mode: 'create_new' })}
          >
            新建物料
          </WorkflowButton>
        </div>
        <label>
          挂载点
          <select
            aria-label="挂载点"
            value={editor.mountUuid}
            disabled={!editable}
            onChange={(event) => onChange({ mountUuid: event.target.value })}
          >
            {editor.mounts.map((mount) => (
              <option key={mount.uuid} value={mount.uuid}>
                {mount.name}
              </option>
            ))}
          </select>
        </label>
        {editor.mode === 'existing' && (
          <WorkflowResourceSelector
            label="固定物料"
            value={editor.fixedMaterialUuid ?? ''}
            optionsState={{
              kind: 'ready',
              options: editor.fixedMaterials.map((material) => ({
                materialUuid: material.uuid,
                resourceTemplateUuid: material.resourceTemplateUuid,
                displayLabel: workflowResourceSlotOptionLabel(
                  material.name,
                  material.uuid
                )
              }))
            }}
            allowedResourceTemplateUuids={[editor.resourceTemplateUuid]}
            disabled={!editable}
            emptyLabel="运行时自动选择"
            onChange={(materialUuid) => onChange({
              fixedMaterialUuid: materialUuid
            })}
          />
        )}
      </fieldset>

      <fieldset>
        <legend>库位范围</legend>
        <label>
          库位范围
          <select
            aria-label="库位范围"
            value={editor.siteScope}
            disabled={!editable}
            onChange={(event) => {
              const scope = event.target.value as MaterialSourceSelectorUpdate['siteScope']
              const firstSite = editor.sites[0]?.uuid ?? null
              onChange({
                siteScope: scope,
                fixedSiteUuid: scope === 'fixed' ? firstSite : null,
                candidateSiteUuids: scope === 'candidates' && firstSite
                  ? [firstSite]
                  : []
              })
            }}
          >
            <option value="all">全部兼容的直接库位</option>
            <option value="fixed" disabled={editor.sites.length === 0}>
              固定库位
            </option>
            <option value="candidates" disabled={editor.sites.length === 0}>
              候选库位集
            </option>
          </select>
        </label>
        {editor.siteScope === 'fixed' && (
          <label>
            固定库位
            <select
              aria-label="固定库位"
              value={editor.fixedSiteUuid ?? ''}
              disabled={!editable}
              onChange={(event) => onChange({
                fixedSiteUuid: event.target.value
              })}
            >
              {editor.sites.map((site) => (
                <option key={site.uuid} value={site.uuid}>
                  {site.name} · #{site.sortOrder}
                </option>
              ))}
            </select>
          </label>
        )}
        {editor.siteScope === 'candidates' && (
          <div className="persistent-authoring__candidate-site-selector">
            <label>
              搜索候选库位
              <input
                type="search"
                aria-label="搜索候选库位"
                value={siteQuery}
                placeholder="名称、顺序或 UUID"
                onChange={(event) => setSiteQuery(event.target.value)}
              />
            </label>
            <p role="status">
              已选择 {editor.candidateSiteUuids.length} / {editor.sites.length}
              {siteQuery && ` · 显示 ${visibleSites.length}`}
            </p>
            <div
              className="persistent-authoring__candidate-sites"
              role="group"
              aria-label="候选库位"
            >
              {visibleSites.map((site) => {
                const checked = editor.candidateSiteUuids.includes(site.uuid)
                return (
                  <label key={site.uuid}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!editable || (
                        checked && editor.candidateSiteUuids.length === 1
                      )}
                      onChange={(event) => onChange({
                        candidateSiteUuids: event.target.checked
                          ? [...editor.candidateSiteUuids, site.uuid]
                          : editor.candidateSiteUuids.filter((uuid) =>
                              uuid !== site.uuid
                            )
                      })}
                    />
                    <span>
                      {site.name}
                      <small>
                        库位 #{site.sortOrder} · {' '}
                        {site.occupiedMaterialUuid ? '已占用' : '空闲'}
                      </small>
                    </span>
                  </label>
                )
              })}
              {visibleSites.length === 0 && (
                <p role="status">没有匹配的候选库位</p>
              )}
            </div>
          </div>
        )}
        {editor.sites.length === 0 && (
          <p role="status">当前挂载点没有兼容的直接库位；OS 预览将给出诊断。</p>
        )}
      </fieldset>

      {editor.staleReferences.length > 0 && (
        <div className="persistent-authoring__selector-warning" role="alert">
          <strong>引用已失效</strong>
          {editor.staleReferences.map((reference) => (
            <span key={reference}>{reference}</span>
          ))}
        </div>
      )}
      {diagnostics.length > 0 && (
        <ul className="persistent-authoring__selector-diagnostics">
          {diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.code}:${index}`}>
              <code>{diagnostic.code}</code>
              <span>{diagnostic.message}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="persistent-authoring__selector-authority">
        仅保存稳定 UUID；库位按业务顺序展示，候选集按 UUID 规范保存。
      </p>
    </section>
  )
}

/** 按名称、业务顺序或稳定 UUID 筛选候选库位（Site）。 */
export function filterMaterialSourceSites(
  sites: MaterialSourceEditorProjection['sites'],
  query: string
): MaterialSourceEditorProjection['sites'] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return sites
  return sites.filter((site) => (
    `${site.name} #${site.sortOrder} ${site.uuid}`
      .toLocaleLowerCase()
      .includes(normalized)
  ))
}

/** 将物料流角色（MaterialFlowRole）映射为权威中文显示名。 */
function materialFlowRoleLabel(flowRole: string): string {
  return {
    primary_sample: '主样品',
    aliquot_sample: '分装样品',
    reagent: '试剂',
    consumable: '耗材'
  }[flowRole] || flowRole
}
