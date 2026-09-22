import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { DataAuthorityNotice, ModuleHeader, WorkstationDataState } from '../ModuleHeader'
import { PointJsonDialog, RemovePointDialog, SavePointDialog, SitePickerDialog } from '../points/PointDialogs'
import {
  choosePointFile,
  cloneSites,
  filterSites,
  nextPointVersion,
  parsePointDocument,
  persistPointFile,
  type PointFileHandle,
} from '../points/pointFile'
import { EmptyPointState, PointEditor, PointFileFooter, pointStatusLabel } from '../points/PointEditor'
import type {
  PointConfigVersion,
  PointManagementSnapshot,
  RobotPoint,
  SiteCatalogRecord,
  WorkstationDataStatus,
  WorkstationSite
} from '../types'
import { buttonClass, pillClass, uiClass } from '../uiClasses'
import { WorkstationIcon } from '../WorkstationIcon'
import styles from '../workstation.module.scss'

const SITE_CATEGORIES: readonly WorkstationSite['category'][] = ['原料库位', '缓存库位', '工装库位']

interface PointManagementModuleProps {
  snapshot?: PointManagementSnapshot
  status: WorkstationDataStatus
  onDirtyChange?: (dirty: boolean) => void
}

type PointDialog = 'site' | 'save' | 'preview' | 'remove' | null

/**
 * 展示后端点位目录；接口不可用时隐藏全部前端夹具和写操作。
 * @param props 后端快照、接口状态与可选草稿变更回调。
 * @returns 真实点位工作区或明确的未接入/错误空态。
 */
export function PointManagementModule({
  snapshot,
  status,
  onDirtyChange
}: PointManagementModuleProps): React.JSX.Element {
  if (status.phase !== 'ready' || !snapshot) {
    return (
      <div className={uiClass.modulePage} data-testid="workstation-points">
        <ModuleHeader title="机械臂点位管理" description="读取后端点位目录并维护经过验证的控制点。" />
        <WorkstationDataState status={status} title={pointStateTitle(status)} icon="point" />
      </div>
    )
  }
  if (snapshot.sites.length === 0) {
    return (
      <div className={uiClass.modulePage} data-testid="workstation-points">
        <ModuleHeader title="机械臂点位管理" description="读取后端点位目录并维护经过验证的控制点。" />
        <WorkstationDataState
          status={{ phase: 'empty', message: '点位接口已连接，但当前没有已发布点位。', retry: status.retry }}
          title="暂无机械臂点位"
          icon="point"
        />
      </div>
    )
  }
  return <PointFileWorkspace snapshot={snapshot} onDirtyChange={onDirtyChange} />
}

/** 管理已由后端提供的点位快照，并保持文件草稿与生产发布边界。 */
function PointFileWorkspace({
  snapshot,
  onDirtyChange
}: {
  snapshot: PointManagementSnapshot
  onDirtyChange?: (dirty: boolean) => void
}): React.JSX.Element {
  const [sites, setSites] = useState<WorkstationSite[]>(() => cloneSites(snapshot.sites))
  const [history, setHistory] = useState<PointConfigVersion[]>(() => [...snapshot.history])
  const [selectedSiteId, setSelectedSiteId] = useState(snapshot.sites[0]?.id ?? '')
  const [selectedPointId, setSelectedPointId] = useState(snapshot.sites[0]?.points[0]?.id ?? '')
  const [query, setQuery] = useState('')
  const [dirty, setDirty] = useState(false)
  const [editorDirty, setEditorDirty] = useState(false)
  const [dialog, setDialog] = useState<PointDialog>(null)
  const [feedback, setFeedback] = useState('后端点位配置已载入；未保存修改仅保留在当前文件草稿')
  const importInputRef = useRef<HTMLInputElement>(null)
  const importedHandleRef = useRef<PointFileHandle | null>(null)
  const selectedSite = sites.find((site) => site.id === selectedSiteId) ?? sites[0]
  const selectedPoint = selectedSite?.points.find((point) => point.id === selectedPointId) ?? selectedSite?.points[0]
  const visibleSites = useMemo(() => filterSites(sites, query), [query, sites])
  const availableSites = snapshot.catalog.filter((catalogSite) => !sites.some((site) => site.id === catalogSite.id))
  const nextVersion = nextPointVersion(history)

  useEffect(() => {
    const hasUnsavedChanges = dirty || editorDirty
    onDirtyChange?.(hasUnsavedChanges)
    const warnBeforeLeave = (event: BeforeUnloadEvent): void => {
      if (!hasUnsavedChanges) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeLeave)
    return () => window.removeEventListener('beforeunload', warnBeforeLeave)
  }, [dirty, editorDirty, onDirtyChange])

  /** 防止切换点位或库位时静默丢失尚未点击“更新点位”的表单草稿。 */
  function confirmEditorDiscard(): boolean {
    if (!editorDirty) return true
    if (!window.confirm('当前点位表单尚未更新到配置，是否放弃这部分表单修改？')) return false
    setEditorDirty(false)
    return true
  }

  /** 选择库位时同步选择首个控制点。 */
  function selectSite(site: WorkstationSite): void {
    if (!confirmEditorDiscard()) return
    setSelectedSiteId(site.id)
    setSelectedPointId(site.points[0]?.id ?? '')
  }

  /** 从库位主表加入记录，并自动生成四个标准点位。 */
  function addCatalogSite(catalogSite: SiteCatalogRecord): void {
    if (!confirmEditorDiscard()) return
    const next: WorkstationSite = {
      ...catalogSite,
      calibrated: false,
      points: createStandardPoints(catalogSite.id),
    }
    setSites((current) => [...current, next])
    setSelectedSiteId(next.id)
    setSelectedPointId(next.points[0].id)
    setDirty(true)
    setDialog(null)
    setFeedback(`${next.id} 已从库位主表加入，并生成 4 个待标定点位`)
  }

  /** 应用显式提交的点位表单，并进入待验证状态。 */
  function applyPoint(next: RobotPoint): string | null {
    if (!selectedSite || !selectedPoint) return '请选择点位'
    const name = next.label.trim()
    if (!name || name.length > 64) return '点位名称需为 1–64 个字符'
    if (selectedSite.points.some((point) => point.id !== selectedPoint.id && point.label === name)) {
      return '同一库位下点位名称不能重复'
    }
    setSites((current) =>
      current.map((site) =>
        site.id === selectedSite.id
          ? {
              ...site,
              calibrated: false,
              points: site.points.map((point) =>
                point.id === selectedPoint.id ? { ...next, label: name, status: 'pending_verification' } : point,
              ),
            }
          : site,
      ),
    )
    setDirty(true)
    setFeedback(`${selectedPoint.id} 已更新，状态变为待验证`)
    return null
  }

  /** 新增自定义点位；custom 是点位类型而不是状态。 */
  function addCustomPoint(): void {
    if (!selectedSite || !confirmEditorDiscard()) return
    const sequence = Math.max(0, ...selectedSite.points.map((point) => Number(point.id.match(/_CUSTOM_(\d+)$/)?.[1] ?? 0))) + 1
    const point: RobotPoint = {
      id: `${selectedSite.id}_CUSTOM_${sequence}`,
      label: `自定义点位 ${sequence}`,
      kind: 'custom',
      motion: 'PTP',
      status: 'uncalibrated',
      pose: selectedPoint ? { ...selectedPoint.pose } : { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
    }
    setSites((current) => current.map((site) => (site.id === selectedSite.id ? { ...site, points: [...site.points, point] } : site)))
    setSelectedPointId(point.id)
    setEditorDirty(false)
    setDirty(true)
    setFeedback(`${point.id} 已加入本地配置`)
  }

  /** 从当前配置移除自定义点位，历史版本保留。 */
  function removeSelectedPoint(): void {
    if (!selectedSite || !selectedPoint || selectedPoint.kind !== 'custom') return
    const remaining = selectedSite.points.filter((point) => point.id !== selectedPoint.id)
    setSites((current) => current.map((site) => (site.id === selectedSite.id ? { ...site, points: remaining } : site)))
    setSelectedPointId(remaining[0]?.id ?? '')
    setEditorDirty(false)
    setDirty(true)
    setDialog(null)
    setFeedback(`${selectedPoint.id} 已从当前配置移除；历史版本未删除`)
  }

  /** 优先通过可写句柄导入，以支持后续直接覆写原文件。 */
  async function requestImport(): Promise<void> {
    if (!confirmEditorDiscard()) return
    try {
      const selection = await choosePointFile()
      if (!selection) {
        importInputRef.current?.click()
        return
      }
      importedHandleRef.current = selection.handle
      await importFile(selection.file)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setFeedback(error instanceof Error ? error.message : '点位文件无法读取')
    }
  }

  /** 解析用户选择的点位 JSON，并将其作为未修改的本地草稿载入。 */
  async function importFile(file: File): Promise<void> {
    try {
      const imported = parsePointDocument(JSON.parse(await file.text()) as unknown)
      const importedSites = imported.sites
      setSites(importedSites)
      if (imported.history.length) setHistory(imported.history)
      setSelectedSiteId(importedSites[0].id)
      setSelectedPointId(importedSites[0].points[0]?.id ?? '')
      setDirty(false)
      setEditorDirty(false)
      setFeedback(`已导入 ${file.name}${importedHandleRef.current ? '；保存时可直接修改原文件' : '；当前浏览器保存时将下载新文件'}`)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '点位文件无法读取')
    }
  }

  /** 保存文件并追加只包含说明、时间和哈希的版本记录。 */
  async function savePointFile(note: string): Promise<void> {
    try {
      const result = await persistPointFile(sites, nextVersion, note, history, importedHandleRef.current)
      setHistory((current) => [
        {
          version: nextVersion,
          note,
          savedAt: new Date().toISOString(),
          fileHash: result.hash,
        },
        ...current,
      ])
      setDirty(false)
      setDialog(null)
      setFeedback(result.mode === 'direct' ? `v${nextVersion} 已直接写入文件` : `v${nextVersion} 已下载；当前环境不支持直接写文件`)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setFeedback(error instanceof Error ? error.message : '点位文件保存失败')
    }
  }

  /** 为点位标签提供 roving tabindex 和方向键、Home、End 导航。 */
  function handlePointKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const tabs = selectedSite?.points ?? []
    if (!tabs.length) return
    const currentIndex = tabs.findIndex((point) => point.id === selectedPoint?.id)
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : event.key === 'ArrowRight' || event.key === 'ArrowDown'
            ? (currentIndex + 1) % tabs.length
            : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
              ? (currentIndex - 1 + tabs.length) % tabs.length
              : null
    if (nextIndex === null) return
    event.preventDefault()
    const nextPoint = tabs[nextIndex]
    if (!confirmEditorDiscard()) return
    setSelectedPointId(nextPoint.id)
    event.currentTarget.querySelector<HTMLButtonElement>(`#point-tab-${nextPoint.id}`)?.focus()
  }

  return (
    <div className={uiClass.modulePage} data-testid="workstation-points">
      <ModuleHeader
        title="机械臂点位管理"
        description="从库位主表选择 Site，维护点位状态，并将版本化配置保存为本地 JSON。"
        actions={
          <>
            <input
              ref={importInputRef}
              className={uiClass.screenReaderOnly}
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                importedHandleRef.current = null
                const file = event.currentTarget.files?.[0]
                if (file) void importFile(file)
              }}
            />
            <button className={buttonClass()} type="button" onClick={() => void requestImport()}>
              <WorkstationIcon name="folder" />
              导入文件
            </button>
            <button
              className={buttonClass('primary')}
              type="button"
              disabled={!dirty || editorDirty}
              title={editorDirty ? '请先更新当前点位' : undefined}
              onClick={() => setDialog('save')}
            >
              <WorkstationIcon name="save" />
              保存修改
            </button>
          </>
        }
      />
      <DataAuthorityNotice>
        读取机械臂位姿、点位验证和发布均需要可信设备回执；当前仅编辑本地文件，不修改权威库位（Site）。
      </DataAuthorityNotice>

      <div className={styles.pointsGrid}>
        <section className={`${uiClass.panel} ${styles.siteCatalog}`} aria-labelledby="site-catalog-title">
          <div className={uiClass.panelHeader}>
            <h2 id="site-catalog-title">库位列表</h2>
            <button className={buttonClass('secondary', 'compact')} type="button" onClick={() => setDialog('site')}>
              <WorkstationIcon name="plus" />
              新建
            </button>
          </div>
          <label className={styles.searchField}>
            <WorkstationIcon name="search" />
            <span className={uiClass.screenReaderOnly}>搜索库位</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索库位编号 / 名称" />
          </label>
          <div className={styles.siteCategoryList}>
            {SITE_CATEGORIES.map((category) => {
              const categorySites = visibleSites.filter((site) => site.category === category)
              return (
                <details key={category} open>
                  <summary>
                    {category}
                    <span>{categorySites.length}</span>
                  </summary>
                  <div className={styles.siteList}>
                    {categorySites.map((site) => (
                      <button
                        key={site.id}
                        type="button"
                        className={site.id === selectedSite?.id ? styles.siteActive : undefined}
                        onClick={() => selectSite(site)}
                      >
                        <span className={styles.siteIcon}>
                          <WorkstationIcon name="site" />
                        </span>
                        <span>
                          <strong>
                            {site.id} · {site.label}
                          </strong>
                          <small>{site.points.length} 个点位</small>
                        </span>
                        <span className={pillClass(site.calibrated ? 'success' : 'warning')}>{site.calibrated ? '已标定' : '待标定'}</span>
                      </button>
                    ))}
                  </div>
                </details>
              )
            })}
          </div>
        </section>

        <section className={uiClass.panel} aria-labelledby="point-parameters-title">
          <div className={uiClass.panelHeader}>
            <div>
              <h2 id="point-parameters-title">点位参数</h2>
              <small>{selectedSite ? `${selectedSite.id} · ${selectedSite.label}` : '请选择库位'}</small>
            </div>
            <div className={styles.fileActions}>
              <button className={buttonClass('secondary', 'compact')} type="button" onClick={addCustomPoint}>
                <WorkstationIcon name="plus" />
                自定义点位
              </button>
              <button className={buttonClass()} type="button" disabled title="未连接设备执行端">
                <WorkstationIcon name="jog" />
                进入设备动作
              </button>
            </div>
          </div>
          {selectedSite ? (
            <>
              <div className={styles.pointTabs} role="tablist" aria-label={`${selectedSite.id} 点位`} onKeyDown={handlePointKeyDown}>
                {selectedSite.points.map((point) => (
                  <button
                    key={point.id}
                    id={`point-tab-${point.id}`}
                    type="button"
                    role="tab"
                    aria-selected={point.id === selectedPoint?.id}
                    aria-controls="point-editor-panel"
                    tabIndex={point.id === selectedPoint?.id ? 0 : -1}
                    onClick={() => {
                      if (confirmEditorDiscard()) setSelectedPointId(point.id)
                    }}
                  >
                    <span className={styles.pointTypeIcon}>
                      <WorkstationIcon name={point.kind === 'custom' ? 'jog' : 'point'} />
                    </span>
                    <strong>{point.label}</strong>
                    <small>{pointStatusLabel(point.status)}</small>
                  </button>
                ))}
              </div>
              {selectedPoint ? (
                <PointEditor
                  key={selectedPoint.id}
                  site={selectedSite}
                  point={selectedPoint}
                  onApply={applyPoint}
                  onRemove={() => setDialog('remove')}
                  onDraftDirtyChange={setEditorDirty}
                />
              ) : (
                <EmptyPointState onCreate={addCustomPoint} />
              )}
              <PointFileFooter history={history} dirty={dirty} feedback={feedback} onPreview={() => setDialog('preview')} />
            </>
          ) : null}
        </section>
      </div>
      {dialog === 'site' ? <SitePickerDialog sites={availableSites} onSelect={addCatalogSite} onClose={() => setDialog(null)} /> : null}
      {dialog === 'save' ? (
        <SavePointDialog version={nextVersion} onSave={(note) => void savePointFile(note)} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'preview' ? (
        <PointJsonDialog sites={sites} version={nextVersion} history={history} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'remove' && selectedPoint ? (
        <RemovePointDialog pointLabel={selectedPoint.label} onConfirm={removeSelectedPoint} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  )
}

/**
 * 为后端目录中的新库位生成空的标准控制点集合。
 * @param siteId 库位（Site）稳定身份。
 * @returns 四个零位姿、未标定的文件草稿点；不会提交后端。
 */
function createStandardPoints(siteId: string): RobotPoint[] {
  return [
    ['HOME', '待机位', 'home'],
    ['APPROACH', '接近位', 'approach'],
    ['INTERACT', '交互位', 'interact'],
    ['RETREAT', '撤离位', 'retreat']
  ].map(([suffix, label, kind]) => ({
    id: `${siteId}_${suffix}`,
    label,
    kind: kind as RobotPoint['kind'],
    motion: suffix === 'HOME' ? 'PTP' : 'LIN',
    status: 'uncalibrated',
    pose: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
  }))
}

/** 返回点位接口状态的简短标题。 */
function pointStateTitle(status: WorkstationDataStatus): string {
  if (status.phase === 'loading') return '正在读取机械臂点位'
  if (status.phase === 'error') return '机械臂点位读取失败'
  if (status.phase === 'unavailable') return '点位接口尚未接入'
  return '暂无机械臂点位'
}
