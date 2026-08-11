import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const ARTIFACT_ROOT = resolve(
  process.cwd(),
  '..',
  'e2e-artifacts',
  'materials',
  'reagent'
)

/** 证明单一试剂容器台账覆盖登记、结构化筛选和关联履历流程。 */
test('试剂模块覆盖完整业务流程并保持权威边界', async ({ page }) => {
  mkdirSync(ARTIFACT_ROOT, { recursive: true })
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })

  await page.setViewportSize({ width: 1680, height: 1050 })
  await page.goto('/material-create-fixture.html')
  await page.getByRole('navigation', { name: '产品模块' })
    .getByRole('button', { name: '试剂', exact: true })
    .click()

  const workspace = page.locator('#reagent-workspace')
  await expect(workspace.getByRole('heading', {
    name: '试剂台账',
    exact: true
  }))
    .toBeVisible()
  await expect(workspace.getByText('96 孔板', { exact: true })).toHaveCount(0)
  await expect(workspace.locator('.reagent-workspace__sections')).toHaveCount(0)
  await expect(workspace.locator('.reagent-ledger__view-switch')).toHaveCount(0)
  const containerLedger = workspace.getByRole('region', {
    name: '试剂容器台账'
  })
  await expect(containerLedger.getByRole('heading', {
    name: '全部试剂容器'
  })).toBeVisible()
  await expect(containerLedger.getByRole('columnheader')).toHaveCount(6)
  await workspace.getByRole('button', {
    name: /磷酸盐缓冲液（PBS）/
  }).first().click()
  await expect(workspace.getByRole('heading', {
    name: '磷酸盐缓冲液（PBS）'
  }))
    .toBeVisible()
  await expect(containerLedger.getByRole('button', {
    name: /PBS 500 mL #01/
  }).first()).toBeVisible()
  await expect(workspace.getByText('库位占用（SiteOccupancy）', {
    exact: false
  }).first())
    .toBeVisible()
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '00-reagent-ledger-unified.png'),
    animations: 'disabled'
  })

  await workspace.getByRole('button', { name: '＋ 新建试剂' }).click()
  const createPanel = page.locator('#reagent-create-page')
  await expect(createPanel.getByRole('heading', {
    name: '登记试剂并创建首个容器'
  })).toBeVisible()
  await expect(createPanel.getByText('不会自动发生')).toBeVisible()
  await expect(createPanel.getByRole('button', {
    name: '创建并返回试剂台账'
  })).toBeDisabled()
  await createPanel.getByPlaceholder('例如：磷酸盐缓冲液（PBS）')
    .fill('RPMI 1640 培养基')
  await createPanel.getByPlaceholder('LOT-20260809-01')
    .fill('RPMI-20260809')
  await createPanel.getByPlaceholder('PBS 500 mL #01')
    .fill('RPMI 500 mL #01')
  await createPanel.getByPlaceholder('REAG-PBS-001')
    .fill('REAG-RPMI-001')
  await createPanel.getByText('初始数量').locator('..').getByRole('spinbutton')
    .fill('500')
  const createCustomFields = createPanel.getByRole('region', {
    name: '自定义字段'
  })
  await createCustomFields.getByRole('button', { name: '＋ 新增字段' }).click()
  await createCustomFields.getByLabel('自定义字段 1 名称').fill('培养用途')
  await createCustomFields.getByLabel('自定义字段 1 值').fill('悬浮细胞')
  await expect(createPanel.getByRole('button', {
    name: '创建并返回试剂台账'
  })).toBeEnabled()
  await createPanel.locator('.reagent-create__form').evaluate((element) => {
    element.scrollTop = 0
  })
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '01-reagent-create.png'),
    animations: 'disabled'
  })
  await createPanel.getByRole('button', {
    name: '创建并返回试剂台账'
  }).click()
  await expect(containerLedger).toBeVisible()
  expect(await page.evaluate(() => ({
    name: window.__UNILAB_REAGENT_CREATE_COMMAND__?.reagentInfo.name,
    customFields:
      window.__UNILAB_REAGENT_CREATE_COMMAND__?.reagentInfo.customFields
  }))).toEqual({
    name: 'RPMI 1640 培养基',
    customFields: [{
      key: 'custom_field_1',
      label: '培养用途',
      value: '悬浮细胞'
    }]
  })

  const inspector = workspace.locator('.reagent-info-inspector')
  const customFields = inspector.getByRole('region', { name: '自定义字段' })
  await expect(customFields.getByText('缓冲液 pH', { exact: true }))
    .toBeVisible()
  await expect(customFields.getByText('7.4', { exact: true })).toBeVisible()

  await workspace.getByRole('button', { name: '编辑信息' }).click()
  await expect(workspace.getByRole('button', { name: '保存试剂信息' }))
    .toBeEnabled()
  await expect(workspace.getByText('保存只修改试剂信息，不改系统代码。'))
    .toBeVisible()
  await expect(customFields.getByLabel('自定义字段 1 名称'))
    .toHaveValue('缓冲液 pH')
  await customFields.getByRole('button', { name: '＋ 新增字段' }).click()
  await customFields.getByLabel('自定义字段 3 名称').fill('内部标准编号')
  await customFields.getByLabel('自定义字段 3 值').fill('STD-PBS-07')
  await customFields.scrollIntoViewIfNeeded()
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '02-reagent-custom-fields.png'),
    animations: 'disabled'
  })
  await workspace.getByRole('button', { name: '保存试剂信息' }).click()
  expect(await page.evaluate(() => ({
    id: window.__UNILAB_REAGENT_UPDATE_COMMAND__?.id,
    customFields: window.__UNILAB_REAGENT_UPDATE_COMMAND__?.customFields
  }))).toEqual({
    id: 'reagent-info-pbs',
    customFields: [
      { key: 'buffer_ph', label: '缓冲液 pH', value: '7.4' },
      { key: 'sterility', label: '无菌等级', value: '无菌过滤' },
      {
        key: 'custom_field_1',
        label: '内部标准编号',
        value: 'STD-PBS-07'
      }
    ]
  })

  await inspector.getByRole('tab', { name: '历史记录' }).click()
  const reagentHistory = inspector.getByRole('tabpanel', {
    name: '历史记录'
  })
  await expect(reagentHistory.getByText('关联该试剂下的全部批次与容器'))
    .toBeVisible()
  await expect(reagentHistory.locator('.reagent-history__timeline')
    .getByText('实验消耗', { exact: true })).toBeVisible()
  await expect(reagentHistory.getByText('-30 mL')).toBeVisible()
  await expect(reagentHistory.getByText('从暂存架转移到试剂冷藏柜', {
    exact: false
  }))
    .toHaveCount(0)
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '04-reagent-history.png'),
    animations: 'disabled'
  })

  const reagentFilter = containerLedger.getByRole('combobox', {
    name: '按试剂筛选'
  })
  const siteFilter = containerLedger.getByRole('combobox', {
    name: '按库位筛选'
  })
  await reagentFilter.selectOption('all')
  await siteFilter.selectOption('__unplaced__')
  await expect(containerLedger.getByRole('button', {
    name: /二甲基亚砜（DMSO）/
  })).toBeVisible()
  await expect(containerLedger.getByRole('button', { name: /PBS 500 mL #01/ }))
    .toHaveCount(0)
  await containerLedger.getByRole('button', { name: /二甲基亚砜（DMSO）/ })
    .click()
  await expect(workspace.getByRole('heading', {
    name: '二甲基亚砜（DMSO）'
  })).toBeVisible()
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '03-reagent-ledger-filtered.png'),
    animations: 'disabled'
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(workspace).toBeVisible()
  const mobileDetailLink = workspace.getByRole('button', {
    name: '查看所选试剂详情'
  })
  await expect(mobileDetailLink).toBeVisible()
  await mobileDetailLink.click()
  await expect(inspector.getByRole('heading', {
    name: '二甲基亚砜（DMSO）'
  })).toBeVisible()
  await expect(inspector.getByRole('tab', { name: '基本信息' })).toBeVisible()
  await expect(inspector.getByRole('tab', { name: '历史记录' })).toBeVisible()
  const bounds = await workspace.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0)
  expect(bounds?.width ?? 0).toBeLessThanOrEqual(390)
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '06-reagent-mobile-check.png'),
    animations: 'disabled'
  })

  expect(browserErrors).toEqual([])
})
