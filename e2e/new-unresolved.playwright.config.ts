import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

const vite = resolve(
  process.cwd(),
  'apps/kernel-web/node_modules/.bin/vite'
)
const viteConfig = resolve(
  process.cwd(),
  'e2e/new-unresolved.vite.config.ts'
)

export default defineConfig({
  testDir: '.',
  testMatch: 'new-unresolved-page.spec.ts',
  timeout: 30_000,
  workers: 1,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://127.0.0.1:4176',
    headless: true,
    viewport: { width: 1440, height: 960 },
    colorScheme: 'light',
    locale: 'zh-CN',
    trace: 'retain-on-failure'
  },
  webServer: {
    cwd: process.cwd(),
    command: `${vite} build --config ${viteConfig} && ${vite} preview --config ${viteConfig}`,
    url: 'http://127.0.0.1:4176/new-unresolved-page-fixture.html',
    reuseExistingServer: false,
    timeout: 120_000
  },
  reporter: [['list']]
})
