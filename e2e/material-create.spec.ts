import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ARTIFACT_ROOT = resolve(
  process.cwd(),
  '..',
  'e2e-artifacts',
  'materials',
  'create'
)

/** 证明物料模块沿类型、批次、实例创建、配置和位置形成连续业务路径。 */
test('物料模块完成层级管理和单实例创建', async ({ page }) => {
  mkdirSync(ARTIFACT_ROOT, { recursive: true })
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })

  await page.setViewportSize({ width: 1680, height: 1050 })
  await page.goto('/material-create-fixture.html')

  await expect(page.getByRole('heading', { name: '物料', exact: true }))
    .toBeVisible()
  await expect(page.locator('.material-center__authority')).toContainText(
    '物料数据已加载'
  )
  const catalogTab = page.getByRole('tab', { name: '物料管理' })
  const spatialTab = page.getByRole('tab', { name: '位置' })
  await expect(page.locator('.material-center__views [role="tab"]'))
    .toHaveCount(3)
  await expect(page.getByRole('tab', { name: '试剂', exact: true }))
    .toHaveCount(0)
  await expect(catalogTab).toHaveAttribute('aria-selected', 'true')
  await catalogTab.focus()
  await page.keyboard.press('ArrowRight')
  await expect(spatialTab).toHaveAttribute('aria-selected', 'true')
  await spatialTab.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(catalogTab).toHaveAttribute('aria-selected', 'true')

  const catalog = page.getByRole('tabpanel', {
    name: '物料管理'
  })
  await expect(catalog.getByRole('button', { name: /试剂瓶/ })).toHaveCount(0)
  await catalog.locator('.material-catalog__templates')
    .getByRole('button', { name: /96 孔板/ })
    .click()
  await expect(catalog.locator('.material-catalog__section-title'))
    .toContainText('物料类型')
  await expect(catalog.getByRole('heading', { name: '物料批次' })).toBeVisible()
  await expect(catalog.getByRole('button', { name: /B-20260808/ }))
    .toBeVisible()
  await expect(catalog.getByRole('cell', { name: /PCR Plate/ })).toHaveCount(2)
  await expect(catalog.getByText('96 个容器位', { exact: false }).first())
    .toBeVisible()
  await expect(catalog.getByText('批次信息暂从物料实例配置读取', {
    exact: false
  })).toBeVisible()
  await expect(page.getByRole('tab', { name: '任务预留' })).toHaveCount(0)
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '00-material-hierarchy.png'),
    animations: 'disabled'
  })

  const templates = catalog.locator('.material-catalog__templates')
  await templates.getByRole('button', { name: /移液枪头盒/ }).click()
  await expect(catalog.getByRole('button', { name: /TIP-20260807/ }))
    .toBeVisible()
  await templates.getByRole('button', { name: /96 孔板/ }).click()
  await catalog.getByRole('button', { name: /B-20260808/ }).click()

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileCatalogBounds = await catalog.boundingBox()
  expect(mobileCatalogBounds).not.toBeNull()
  expect(mobileCatalogBounds?.x ?? -1).toBeGreaterThanOrEqual(0)
  expect(mobileCatalogBounds?.width ?? 0).toBeLessThanOrEqual(390)
  await expect(catalog.getByRole('button', { name: '← 返回物料批次' }))
    .toBeVisible()
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '00-material-hierarchy-mobile.png'),
    animations: 'disabled'
  })
  await page.setViewportSize({ width: 1680, height: 1050 })

  const customTypeTrigger = page.getByRole('button', {
    name: '＋ 新建物料类型'
  })
  await customTypeTrigger.click()
  const typeDraft = page.locator('.material-type-draft--embedded')
  await expect(typeDraft).toBeVisible()
  await expect(page.getByRole('heading', { name: '物料', exact: true }))
    .toBeVisible()
  await expect(page.getByRole('tab', { name: '物料管理' }))
    .toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('dialog', { name: '新建物料类型' }))
    .toHaveCount(0)
  await expect(page.locator('.material-type-draft-backdrop')).toHaveCount(0)
  await expect(typeDraft.getByRole('heading', { name: '基本信息' }))
    .toBeVisible()
  await expect(typeDraft.getByText('步骤 1 / 4', { exact: false }))
    .toBeVisible()
  await expect(typeDraft.getByText('完整配置 JSON')).toHaveCount(0)
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '01-custom-material-type.png'),
    animations: 'disabled'
  })
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileBasicBounds = await typeDraft.boundingBox()
  expect(mobileBasicBounds).not.toBeNull()
  expect(mobileBasicBounds?.x ?? -1).toBeGreaterThanOrEqual(0)
  expect(mobileBasicBounds?.width ?? 0).toBeLessThanOrEqual(390)
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '01-custom-material-type-mobile.png'),
    animations: 'disabled'
  })
  await page.setViewportSize({ width: 1680, height: 1050 })

  const typeName = typeDraft.getByRole('textbox', { name: /类型名称/ })
  await typeName.fill('自动化 PCR 板')

  await typeDraft.getByRole('button', { name: /实例字段/ }).click()
  await expect(typeDraft.getByRole('heading', { name: '实例字段' }))
    .toBeVisible()
  await expect(typeDraft.getByText('实例编辑预览', { exact: true }))
    .toBeVisible()
  await expect(typeDraft.getByRole('textbox', { name: '字段 1 配置键' }))
    .toHaveValue('batch')
  await typeDraft.getByRole('button', { name: /基本信息/ }).click()
  await expect(typeDraft.getByRole('textbox', { name: /类型名称/ }))
    .toHaveValue('自动化 PCR 板')
  await typeDraft.getByRole('button', { name: /实例字段/ }).click()

  await typeDraft.getByRole('button', { name: '添加字段' }).click()
  await expect(typeDraft.getByRole('textbox', { name: '字段 3 名称' }))
    .toHaveValue('自定义字段 3')
  const thirdFieldKey = typeDraft.getByRole('textbox', {
    name: '字段 3 配置键'
  })
  await thirdFieldKey.fill('batch')
  await expect(typeDraft.getByText('配置键不能重复', { exact: true }))
    .toHaveCount(2)
  await thirdFieldKey.fill('centrifugeSpeed')
  await expect(typeDraft.getByText('配置键不能重复', { exact: true }))
    .toHaveCount(0)
  await typeDraft.getByRole('textbox', { name: '字段 3 说明' })
    .fill('离心步骤使用的默认转速')
  await typeDraft.getByRole('checkbox', { name: '创建实例时必填' }).last()
    .check()
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '01a-custom-material-fields.png'),
    animations: 'disabled'
  })
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileFieldsBounds = await typeDraft.boundingBox()
  expect(mobileFieldsBounds).not.toBeNull()
  expect(mobileFieldsBounds?.x ?? -1).toBeGreaterThanOrEqual(0)
  expect(mobileFieldsBounds?.width ?? 0).toBeLessThanOrEqual(390)
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '01a-custom-material-fields-mobile.png'),
    animations: 'disabled'
  })
  await page.setViewportSize({ width: 1680, height: 1050 })

  await typeDraft.getByRole('button', { name: '下一步' }).click()
  await expect(typeDraft.getByRole('heading', { name: '容器结构' }))
    .toBeVisible()
  await expect(typeDraft.getByRole('radio', { name: /自定义点位/ }))
    .toBeDisabled()
  await typeDraft.getByLabel('行数').fill('6')
  await typeDraft.getByLabel('列数').fill('4')
  await expect(typeDraft.getByText('24 个内部位置', { exact: true }))
    .toBeVisible()
  await expect(typeDraft.locator('.material-type-draft__grid-cells > span'))
    .toHaveCount(24)
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '01b-custom-material-container.png'),
    animations: 'disabled'
  })
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileLayoutBounds = await typeDraft.boundingBox()
  expect(mobileLayoutBounds).not.toBeNull()
  expect(mobileLayoutBounds?.x ?? -1).toBeGreaterThanOrEqual(0)
  expect(mobileLayoutBounds?.width ?? 0).toBeLessThanOrEqual(390)
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '01b-custom-material-container-mobile.png'),
    animations: 'disabled'
  })
  await page.setViewportSize({ width: 1680, height: 1050 })

  await typeDraft.getByRole('button', { name: '下一步' }).click()
  await expect(typeDraft.getByRole('heading', { name: '兼容规则' }))
    .toBeVisible()
  await expect(typeDraft.getByText('允许承载的内容', { exact: true }))
    .toBeVisible()
  await expect(typeDraft.getByText('允许放入的库位类型', { exact: true }))
    .toBeVisible()
  await expect(typeDraft.getByText('不创建物料实例、不占用库位', {
    exact: false
  })).toBeVisible()
  await typeDraft.getByRole('checkbox', { name: /冷藏库位/ }).check()
  await expect(typeDraft.getByRole('button', { name: '保存为私有类型' }))
    .toBeDisabled()
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '01c-custom-material-compatibility.png'),
    animations: 'disabled'
  })
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileCompatibilityBounds = await typeDraft.boundingBox()
  expect(mobileCompatibilityBounds).not.toBeNull()
  expect(mobileCompatibilityBounds?.x ?? -1).toBeGreaterThanOrEqual(0)
  expect(mobileCompatibilityBounds?.width ?? 0).toBeLessThanOrEqual(390)
  await expect(typeDraft.getByRole('button', { name: '取消' }))
    .toBeInViewport()
  await expect(typeDraft.getByRole('button', { name: '上一步' }))
    .toBeInViewport()
  await expect(typeDraft.getByRole('button', { name: '保存为私有类型' }))
    .toBeInViewport()
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '01c-custom-material-compatibility-mobile.png'),
    animations: 'disabled'
  })
  await page.setViewportSize({ width: 1680, height: 1050 })
  await page.keyboard.press('Escape')
  await expect(typeDraft).toBeVisible()
  await typeDraft.getByRole('button', { name: '取消' }).click()
  await expect(typeDraft).toHaveCount(0)
  await expect(page.getByRole('tab', { name: '物料管理' })).toBeFocused()

  const createFromCurrentType = catalog.getByRole('button', {
    name: '＋ 新建实例'
  })
  await createFromCurrentType.click()
  const instanceCreatePage = page.locator('.material-instance-create')
  await expect(instanceCreatePage.getByRole('heading', {
    name: '新建物料实例'
  })).toBeVisible()
  await expect(instanceCreatePage.getByRole('heading', { name: '96 孔板' }))
    .toBeVisible()
  const nameInput = instanceCreatePage.getByRole('textbox', {
    name: '实例名称'
  })
  const batchInput = instanceCreatePage.getByRole('textbox', {
    name: '物料批次'
  })
  const expiresAtInput = instanceCreatePage.getByLabel('有效期')
  const createButton = instanceCreatePage.getByRole('button', {
    name: '创建并继续配置'
  })
  await expect(nameInput).toHaveValue('96 孔板')
  await expect(batchInput).toHaveValue('B-20260808')
  await expect(instanceCreatePage.getByText('暂不放置', { exact: true }))
    .toBeVisible()
  await expect(page.getByText(/Water 500/i)).toHaveCount(0)

  await nameInput.fill('ＰＣＲ　Ｐｌａｔｅ')
  await expect(instanceCreatePage.getByText('当前物料图中已存在同名物料'))
    .toBeVisible()
  await expect(createButton).toBeDisabled()

  await nameInput.fill('   Run Plate 01   ')
  await expiresAtInput.fill('2027-08-08')
  await expect(createButton).toBeEnabled()
  await page.mouse.click(1510, 720)
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '02-material-instance-create.png'),
    animations: 'disabled'
  })
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileCreateBounds = await instanceCreatePage.boundingBox()
  expect(mobileCreateBounds).not.toBeNull()
  expect(mobileCreateBounds?.x ?? -1).toBeGreaterThanOrEqual(0)
  expect(mobileCreateBounds?.width ?? 0).toBeLessThanOrEqual(390)
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '02-material-instance-create-mobile.png'),
    animations: 'disabled'
  })
  await page.setViewportSize({ width: 1680, height: 1050 })
  await createButton.click()
  await expect(instanceCreatePage).toHaveCount(0)

  const command = await page.evaluate(
    () => window.__UNILAB_MATERIAL_CREATE_COMMAND__
  )
  expect(command).toEqual({
    templateId: 'template-96-well-plate',
    name: 'Run Plate 01',
    placement: { kind: 'unplaced' },
    initialContents: [],
    config: {
      batch: 'B-20260808',
      expiresAt: '2027-08-08'
    },
    expectedRevision: 1
  })
  await expect(catalog.getByRole('cell', { name: /Run Plate 01/ })).toBeVisible()

  const inspector = page.getByRole('dialog', { name: '物料属性' })
  await expect(inspector).toBeVisible()
  await expect(inspector.getByText('编辑物料', { exact: true })).toBeVisible()
  await expect(inspector.getByText('只修改当前物料实例', { exact: true }))
    .toBeVisible()
  await expect(inspector.getByText('保存不会修改系统代码', { exact: false }))
    .toBeVisible()
  await expect(inspector.getByRole('textbox', { name: /批次/ }))
    .toHaveValue('B-20260808')
  await expect(inspector.getByLabel('有效期')).toHaveValue('2027-08-08')
  await expect(inspector.getByText('结构化配置', { exact: true })).toBeVisible()
  await expect(inspector.getByRole('textbox', { name: '完整配置 JSON' }))
    .toHaveCount(0)
  const inspectorBounds = await inspector.boundingBox()
  expect(inspectorBounds).not.toBeNull()
  expect(inspectorBounds?.width ?? 0).toBeGreaterThanOrEqual(440)
  expect(inspectorBounds?.width ?? 0).toBeLessThanOrEqual(520)
  expect(
    Math.abs(
      (inspectorBounds?.x ?? 0) + (inspectorBounds?.width ?? 0) - 1680
    )
  ).toBeLessThanOrEqual(1)
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '03-material-instance-config.png'),
    animations: 'disabled'
  })
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileInspectorBounds = await inspector.boundingBox()
  expect(mobileInspectorBounds).not.toBeNull()
  expect(mobileInspectorBounds?.x ?? -1).toBeGreaterThanOrEqual(0)
  expect(mobileInspectorBounds?.width ?? 0).toBeLessThanOrEqual(390)
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '03-material-instance-config-mobile.png'),
    animations: 'disabled'
  })
  await page.setViewportSize({ width: 1680, height: 1050 })
  await inspector.getByRole('button', { name: '保存修改' }).click()
  await expect(inspector.getByRole('button', { name: '设置存储位置' }))
    .toBeVisible()
  await inspector.getByRole('button', { name: '设置存储位置' }).click()

  const workbench = page.locator('.material-workbench')
  await expect(workbench).toBeVisible()
  await expect(page.getByText('物料列表', { exact: true })).toBeVisible()
  const hostNode = page.locator(
    '.material-flow-node[data-material-code="host_node"]'
  )
  const deviceNode = page.locator(
    '.material-flow-node[data-material-code="PRCXI"]'
  )
  await expect(hostNode).toHaveAttribute('data-default-node-kind', 'control')
  await expect(deviceNode).toHaveAttribute('data-default-node-kind', 'equipment')
  await expect(
    page.locator('.material-flow-node__physical-label', { hasText: /mm/ })
  ).toHaveCount(0)
  const placementGuide = page.getByRole('complementary', {
    name: '物料实例位置配置'
  })
  await expect(placementGuide).toBeVisible()
  await expect(placementGuide.getByText('Run Plate 01', { exact: true }))
    .toBeVisible()
  await expect(placementGuide.getByText('未放置', { exact: true }))
    .toBeVisible()
  const siteSelect = placementGuide.getByRole('combobox', {
    name: '目标库位'
  })
  await siteSelect.selectOption({ label: 'PRCXI_Deck / T3 · deck-slot' })
  await expect(placementGuide.getByRole('button', { name: '确认放置' }))
    .toBeEnabled()
  await expect(
    page.locator('.material-tree-sidebar__label', { hasText: 'Run Plate 01' })
  ).toBeVisible()
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '04-material-position-view.png'),
    animations: 'disabled'
  })
  await page.setViewportSize({ width: 390, height: 844 })
  const mobilePlacementBounds = await placementGuide.boundingBox()
  expect(mobilePlacementBounds).not.toBeNull()
  expect(mobilePlacementBounds?.x ?? -1).toBeGreaterThanOrEqual(0)
  expect(mobilePlacementBounds?.width ?? 0).toBeLessThanOrEqual(390)
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '04-material-position-view-mobile.png'),
    animations: 'disabled'
  })
  await page.setViewportSize({ width: 1680, height: 1050 })
  await placementGuide.getByRole('button', { name: '确认放置' }).click()
  await expect(placementGuide.getByText('PRCXI_Deck / T3', { exact: true }))
    .toBeVisible()

  const updateCommand = await page.evaluate(
    () => window.__UNILAB_MATERIAL_UPDATE_COMMAND__
  )
  expect(updateCommand).toMatchObject({
    materialId: 'run-plate-01',
    expectedRevision: 1,
    patch: {
      name: 'Run Plate 01',
      config: {
        batch: 'B-20260808',
        expiresAt: '2027-08-08'
      }
    }
  })
  const attachCommand = await page.evaluate(
    () => window.__UNILAB_MATERIAL_ATTACH_COMMAND__
  )
  expect(attachCommand).toEqual({
    parentId: 'prcxi-deck',
    childId: 'run-plate-01',
    siteId: 'deck-T3',
    expectedParentRevision: 1,
    expectedChildRevision: 2
  })

  await page.getByRole('tab', { name: /使用记录/ }).click()
  await expect(page.getByRole('heading', { name: '物料使用记录' })).toBeVisible()
  await expect(page.getByText('使用记录服务尚未接入', { exact: true }))
    .toBeVisible()
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, '05-material-usage-history.png'),
    animations: 'disabled'
  })

  writeFileSync(
    resolve(ARTIFACT_ROOT, 'material-create-result.json'),
    JSON.stringify(
      {
        outcome: 'passed',
        assertions: {
          hierarchy: ['ResourceTemplate', 'batch-projection', 'Material'],
          customTypeWriteFailClosed: true,
          legacyWaterNotCopied: true,
          duplicateNameBlocked: true,
          normalizedName: command.name,
          inheritedBatch: command.config?.batch,
          placement: command.placement,
          initialContents: command.initialContents,
          instanceConfigurationSaved: true,
          stableSitePlacement: attachCommand.siteId
        },
        browserErrors
      },
      null,
      2
    )
  )
  expect(browserErrors).toEqual([])
})
