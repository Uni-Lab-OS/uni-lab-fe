import { clsx } from 'clsx'
import appShellStyles from '../../styles/app-shell.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { Button, Dropdown, Input, Modal, Space, Tabs, Tooltip, message } from 'antd'
import { useEffect, useRef, useState } from 'react'
import type { MaterialSummary, Reagent, ReagentInfo } from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import { useBackendQuery } from '../../hooks/useBackendQuery'
import { AppIcon } from '../../components/ui/Icon'
import { AsyncState } from '../../components/ui/AsyncState'
import { PageHeader } from '../../components/ui/PageHeader'
import { ReagentModal, type ReagentListTab, type ReagentModalState } from './ReagentModal'
import { CatalogTable, InventoryTable } from './ReagentTables'
import styles from './ReagentPage.module.scss'

interface ReagentData {
  readonly inventory: readonly Reagent[]
  readonly inventoryTotal: number
  readonly catalog: readonly ReagentInfo[]
  readonly catalogTotal: number
  /** 录入库存时要选全部目录身份，不能只用当前这一页。 */
  readonly catalogOptions: readonly ReagentInfo[]
  readonly materials: readonly MaterialSummary[]
}

const PAGE_SIZE = 10

type ReagentInventoryPort = ReturnType<typeof useBackend>['backend']['core']['reagentInventory']

function includesText(value: string | null | undefined, needle: string): boolean {
  return Boolean(value?.toLowerCase().includes(needle))
}

/**
 * 库存接口的 `cas` 必须整号相等，`keyword` 也不看 CAS。
 * 因此搜索先取全表，再按名称、容器名和 CAS 片段筛选。
 */
function matchesInventory(item: Reagent, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase()
  if (!needle) return true
  return (
    includesText(item.name, needle) ||
    includesText(item.containerName, needle) ||
    includesText(item.cas, needle)
  )
}

/**
 * 目录接口的 `name` 只模糊匹配名称，`cas` 必须整号相等，像 "78" 这种片段
 * 对不上 `141-78-6`。因此目录搜索先取全表，再按名称、英文名和 CAS 片段筛选。
 */
function matchesCatalog(item: ReagentInfo, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase()
  if (!needle) return true
  return [item.name, item.nameEn, item.cas].some((value) => includesText(value, needle))
}

async function listAllPages<T>(
  load: (page: number, pageSize: number) => Promise<{ items: readonly T[]; total: number | null }>,
): Promise<T[]> {
  const pageSize = 500
  const first = await load(1, pageSize)
  const total = first.total ?? first.items.length
  const items = [...first.items]
  for (let page = 2; items.length < total; page += 1) {
    const next = await load(page, pageSize)
    items.push(...next.items)
    if (next.items.length === 0) break
  }
  return items
}

function listAllReagents(port: ReagentInventoryPort): Promise<Reagent[]> {
  return listAllPages((page, pageSize) => port.listReagents({ page, pageSize }))
}

function listAllReagentInfos(port: ReagentInventoryPort): Promise<ReagentInfo[]> {
  return listAllPages((page, pageSize) => port.listReagentInfos({ page, pageSize }))
}

export function ReagentsPage() {
  const { backend } = useBackend()
  const [tab, setTab] = useState<'inventory' | 'catalog'>('inventory')
  const [keyword, setKeyword] = useState('')
  const [submittedKeyword, setSubmittedKeyword] = useState('')
  const [inventoryPage, setInventoryPage] = useState(1)
  const [catalogPage, setCatalogPage] = useState(1)
  const [modal, setModal] = useState<ReagentModalState | null>(null)
  // 拼音组字期间不能把未确认的字母当成搜索词，否则候选还没选上就被提交。
  const composingRef = useRef(false)
  const publishKeyword = (value: string) => {
    setSubmittedKeyword((current) => {
      if (current === value) return current
      setInventoryPage(1)
      setCatalogPage(1)
      return value
    })
  }
  useEffect(() => {
    if (composingRef.current) return
    const timer = window.setTimeout(() => publishKeyword(keyword), 300)
    return () => window.clearTimeout(timer)
  }, [keyword])
  const query = useBackendQuery<ReagentData>(
    `reagent-resources:${tab}:${inventoryPage}:${catalogPage}:${submittedKeyword}`,
    async (current) => {
      const [inventory, catalog, catalogOptions, materials] = await Promise.all([
        tab === 'inventory' && submittedKeyword.trim()
          ? listAllReagents(current.core.reagentInventory).then((items) => {
              const matched = items.filter((item) => matchesInventory(item, submittedKeyword))
              const start = (inventoryPage - 1) * PAGE_SIZE
              return {
                items: matched.slice(start, start + PAGE_SIZE),
                total: matched.length,
              }
            })
          : current.core.reagentInventory.listReagents({
              page: inventoryPage,
              pageSize: PAGE_SIZE,
            }),
        tab === 'catalog' && submittedKeyword.trim()
          ? listAllReagentInfos(current.core.reagentInventory).then((items) => {
              const matched = items.filter((item) => matchesCatalog(item, submittedKeyword))
              const start = (catalogPage - 1) * PAGE_SIZE
              return {
                items: matched.slice(start, start + PAGE_SIZE),
                total: matched.length,
              }
            })
          : current.core.reagentInventory.listReagentInfos({
              page: catalogPage,
              pageSize: PAGE_SIZE,
            }),
        // 登记库存要在全部目录身份里选，不能受当前页和搜索词限制。
        current.core.reagentInventory.listReagentInfos({
          page: 1,
          pageSize: 500,
        }),
        current.core.materialSite.listMaterials({ page: 1, pageSize: 500 }),
      ])
      return {
        inventory: inventory.items,
        inventoryTotal: inventory.total ?? inventory.items.length,
        catalog: catalog.items,
        catalogTotal: catalog.total ?? catalog.items.length,
        catalogOptions: catalogOptions.items,
        materials: materials.items,
      }
    },
  )
  const can = (capability: Parameters<typeof backend.getCapabilityStatus>[0]) =>
    backend.getCapabilityStatus(capability).available
  const canCreateInfo = can('reagentInfo.create')
  const canUpdateInfo = can('reagentInfo.update')
  const canDeleteInfo = can('reagentInfo.delete')
  const canCreateInventory = can('inventory.createReagent')
  const canUpdateInventory = can('inventory.updateReagent')
  const canDeleteInventory = can('inventory.deleteReagent')
  const canReadHistory = can('inventory.readReagentHistory')
  const canDispense = can('inventory.dispenseReagent')
  const canImportCatalog = can('reagentInfo.batchImport')
  const canImportInventory = can('inventory.batchImportReagents')

  /** 写入完成后回到刚刚产生变化的列表，避免用户停留在另一份空结果上。 */
  const handleSaved = (target: ReagentListTab) => {
    setTab(target)
    setKeyword('')
    setSubmittedKeyword('')
    setInventoryPage(1)
    setCatalogPage(1)
    query.reload()
  }

  /**
   * 删除可能被目录引用或被任务预留而被 OS 拒绝，必须把真实原因显示出来，
   * 不能当成"已删除"。
   */
  const confirmDelete = (title: string, content: string, remove: () => Promise<void>) => {
    Modal.confirm({
      title,
      content,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await remove()
          message.success('已删除')
          query.reload()
        } catch (cause) {
          message.error(cause instanceof Error ? cause.message : '删除失败')
          throw cause
        }
      },
    })
  }

  return (
    <div
      className={clsx(
        appShellStyles['page-stack'],
        sharedStyles['page-stack'],
        styles.reagentListPage,
      )}
    >
      <PageHeader
        title="试剂"
        actions={
          <Space>
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'catalog',
                    label: '导入试剂目录',
                    disabled: !canImportCatalog,
                    onClick: () => setModal({ type: 'import', target: 'catalog' }),
                  },
                  {
                    key: 'inventory',
                    label: '导入试剂库存',
                    disabled: !canImportInventory,
                    onClick: () => setModal({ type: 'import', target: 'inventory' }),
                  },
                ],
              }}
            >
              <Button
                disabled={!canImportCatalog && !canImportInventory}
                icon={<AppIcon name="general/upload-01" size={16} />}
              >
                批量导入
              </Button>
            </Dropdown>
            <Tooltip title={canCreateInfo ? undefined : '当前端点未开放试剂目录写入能力。'}>
              <span>
                <Button
                  disabled={!canCreateInfo}
                  icon={<AppIcon name="general/plus" color="primary" size={16} />}
                  onClick={() => setModal({ type: 'create-info' })}
                >
                  新增试剂
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={canCreateInventory ? undefined : '当前端点未开放库存写入能力。'}>
              <span>
                <Button
                  type="primary"
                  disabled={!canCreateInventory}
                  icon={<AppIcon name="development/package-plus" color="white" size={16} />}
                  onClick={() => setModal({ type: 'create-inventory' })}
                >
                  录入库存
                </Button>
              </span>
            </Tooltip>
          </Space>
        }
      />
      <AsyncState
        loading={query.loading && query.data === undefined}
        error={query.error}
        onRetry={query.reload}
        variant="table"
        tableColumns={5}
      >
        <section className={clsx(appShellStyles['data-section'], sharedStyles['data-section'])}>
          <div
            className={clsx(
              appShellStyles['data-section-toolbar'],
              sharedStyles['data-section-toolbar'],
            )}
          >
            <Tabs
              className={styles.reagentTabs}
              activeKey={tab}
              onChange={(key) => {
                setTab(key as 'inventory' | 'catalog')
                setKeyword('')
                setSubmittedKeyword('')
                setInventoryPage(1)
                setCatalogPage(1)
              }}
              items={[
                {
                  key: 'inventory',
                  label: `库存 ${query.data?.inventoryTotal ?? 0}`,
                },
                {
                  key: 'catalog',
                  label: `目录 ${query.data?.catalogTotal ?? 0}`,
                },
              ]}
            />
            <Input
              className={clsx(sharedStyles['search-input'])}
              allowClear
              prefix={<AppIcon name="general/search-md" size={16} />}
              placeholder={tab === 'inventory' ? '搜索库存、容器或 CAS' : '搜索名称或 CAS 号'}
              value={keyword}
              onCompositionStart={() => {
                composingRef.current = true
              }}
              onCompositionEnd={(event) => {
                composingRef.current = false
                const value = event.currentTarget.value
                setKeyword(value)
                publishKeyword(value)
              }}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </div>
          {tab === 'inventory' ? (
            <InventoryTable
              data={query.data?.inventory ?? []}
              page={inventoryPage}
              total={query.data?.inventoryTotal ?? 0}
              onPageChange={setInventoryPage}
              canMutate={canUpdateInventory}
              canDelete={canDeleteInventory}
              canDispense={canDispense}
              onHistory={(item) => setModal({ type: 'history', reagent: item })}
              canReadHistory={canReadHistory}
              onEdit={(item) => setModal({ type: 'edit-inventory', reagent: item })}
              onDispense={(item) => setModal({ type: 'dispense', reagent: item })}
              onDelete={(item) =>
                confirmDelete(`删除库存 ${item.name}`, '存在活动工作流预留时 OS 会拒绝删除。', () =>
                  backend.core.reagentInventory.deleteReagent(item.reagentUuid),
                )
              }
            />
          ) : (
            <CatalogTable
              data={query.data?.catalog ?? []}
              page={catalogPage}
              total={query.data?.catalogTotal ?? 0}
              onPageChange={setCatalogPage}
              canMutate={canCreateInventory}
              canEdit={canUpdateInfo}
              canDelete={canDeleteInfo}
              onDetail={(item) => setModal({ type: 'catalog-detail', info: item })}
              onEdit={(item) => setModal({ type: 'edit-info', info: item })}
              onCreateInventory={(item) => setModal({ type: 'create-inventory', info: item })}
              onDelete={(item) =>
                confirmDelete(`删除目录身份 ${item.name}`, '已被库存引用的试剂身份不可删除。', () =>
                  backend.core.reagentInventory.deleteReagentInfo(item.reagentInfoUuid),
                )
              }
            />
          )}
        </section>
      </AsyncState>
      <ReagentModal
        state={modal}
        materials={query.data?.materials ?? []}
        catalog={query.data?.catalogOptions ?? []}
        onClose={() => setModal(null)}
        onSaved={handleSaved}
      />
    </div>
  )
}
