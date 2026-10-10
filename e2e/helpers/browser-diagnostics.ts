import type { Page } from '@playwright/test'

/** 收集浏览器侧应用错误；网络资源失败由具体 E2E 根据场景单独分类。 */
export function attachBrowserDiagnostics(page: Page, errors: string[] = []): string[] {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}
