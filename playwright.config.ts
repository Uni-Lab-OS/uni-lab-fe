import { defineConfig } from '@playwright/test'

const materialCreateFixture =
  process.env.UNILAB_E2E_MATERIAL_CREATE_FIXTURE === '1'
const electronFixture = process.env.UNILAB_E2E_ELECTRON === '1'
const baseURL =
  process.env.UNILAB_FE_E2E_URL ||
  (materialCreateFixture
    ? 'http://127.0.0.1:4174'
    : 'http://127.0.0.1:4173')

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL,
    headless: process.env.UNILAB_E2E_HEADED !== '1',
    viewport: { width: 1680, height: 1050 },
    colorScheme: 'light',
    locale: 'zh-CN',
    trace: 'retain-on-failure'
  },
  webServer: process.env.UNILAB_FE_E2E_URL || electronFixture
    ? undefined
    : {
        command: materialCreateFixture
          ? 'pnpm exec vite build --config e2e/material-create.vite.config.ts && pnpm exec vite preview --config e2e/material-create.vite.config.ts'
          : 'pnpm build:web && pnpm --filter @unilab/kernel-web preview --host 127.0.0.1 --port 4173',
        url: materialCreateFixture
          ? `${baseURL}/material-create-fixture.html`
          : baseURL,
        reuseExistingServer: true,
        timeout: 120_000
      },
  reporter: [['list']]
})
