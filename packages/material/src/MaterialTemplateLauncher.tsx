import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import type { CapabilityStatus } from './MaterialCapabilityNotice'
import { materialScopeClassName } from './materialStyles'
import { MaterialTemplateLibrary } from './MaterialTemplateLibrary'
import type {
  MaterialTemplateCatalogPort,
  MaterialTemplateDetail,
  MaterialTemplateKind,
  TemplateMaterialDraft
} from './templateMaterial'
import type { MaterialScope } from './types'

export interface MaterialTemplateLauncherProps {
  catalog: MaterialTemplateCatalogPort
  profileId: string
  scope: MaterialScope
  readStatus: CapabilityStatus
  createStatus: CapabilityStatus
  existingNames: readonly string[]
  activeKind?: MaterialTemplateKind | null
  showTabs?: boolean
  onActiveKindChange?: (kind: MaterialTemplateKind | null) => void
  onCreate: (
    template: MaterialTemplateDetail,
    draft: TemplateMaterialDraft
  ) => Promise<void> | void
}

export function MaterialTemplateLauncher({
  catalog,
  profileId,
  scope,
  readStatus,
  createStatus,
  existingNames,
  activeKind: controlledActiveKind,
  showTabs = true,
  onActiveKindChange,
  onCreate
}: MaterialTemplateLauncherProps): React.JSX.Element {
  const [uncontrolledActiveKind, setUncontrolledActiveKind] =
    useState<MaterialTemplateKind | null>(null)
  const activeKind =
    controlledActiveKind === undefined
      ? uncontrolledActiveKind
      : controlledActiveKind

  /**
   * 同步受控或非受控的模板目录类型。
   * @param kind 待打开的模板类型；null 表示关闭目录。
   * @returns 无返回值。
   */
  const setActiveKind = (kind: MaterialTemplateKind | null): void => {
    if (controlledActiveKind === undefined) {
      setUncontrolledActiveKind(kind)
    }
    onActiveKindChange?.(kind)
  }
  const scopeKey =
    scope.kind === 'singleton' ? 'singleton' : scope.laboratoryId
  const templates = useQuery({
    queryKey: ['material-templates', profileId, scopeKey],
    queryFn: () => catalog.listTemplates(scope),
    enabled: readStatus.available
  })
  useEffect(() => setActiveKind(null), [profileId, scopeKey])

  const tabs = useMemo(
    () =>
      [
        {
          kind: 'device' as const,
          label: '仪器设备',
          count: templates.data?.items.filter(
            (template) => template.kind === 'device'
          ).length
        },
        {
          kind: 'resource' as const,
          label: '物料耗材',
          count: templates.data?.items.filter(
            (template) => template.kind === 'resource'
          ).length
        }
      ] satisfies readonly {
        kind: MaterialTemplateKind
        label: string
        count: number | undefined
      }[],
    [templates.data?.items]
  )
  const activeTab = tabs.find((tab) => tab.kind === activeKind)

  return (
    <div
      className={materialScopeClassName('material-template-launcher')}
    >
      {showTabs ? (
        <div
          className="material-template-launcher__tabs"
          aria-label="添加物料"
          role="group"
        >
          {tabs.map((tab) => (
            <button
              key={tab.kind}
              type="button"
              aria-expanded={activeKind === tab.kind}
              className={activeKind === tab.kind ? 'is-active' : undefined}
              disabled={!readStatus.available}
              title={
                readStatus.available
                  ? `浏览${tab.label}模板`
                  : readStatus.reason
              }
              onClick={() =>
                setActiveKind(activeKind === tab.kind ? null : tab.kind)
              }
            >
              <span>{tab.label}</span>
              <small>
                {readStatus.available ? tab.count ?? '…' : '—'}
              </small>
            </button>
          ))}
        </div>
      ) : null}

      {activeKind && activeTab ? (
        <>
          <button
            type="button"
            className="material-template-launcher__backdrop"
            aria-label="关闭模板目录"
            onClick={() => setActiveKind(null)}
          />
          <div className="material-template-launcher__panel">
            <MaterialTemplateLibrary
              catalog={catalog}
              profileId={profileId}
              scope={scope}
              kind={activeKind}
              title={activeTab.label}
              readStatus={readStatus}
              createStatus={createStatus}
              existingNames={existingNames}
              onClose={() => setActiveKind(null)}
              onCreate={onCreate}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}
