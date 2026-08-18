import { expect, test } from '@playwright/test'

test('物料首次切换到仪器设备时主区持续可见', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      api: {
        getVersion: async () => 'e2e',
        auth: {
          getSession: async () => null,
          login: async () => null,
          logout: async () => true
        }
      }
    })
  })

  await page.goto('/?section=material')
  await expect(page.getByRole('heading', { name: '物料工作台' })).toBeVisible()

  await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('.app-shell__main')
    if (!main) throw new Error('找不到工作台主区')

    const isBlank = () => Array.from(main.children).every((child) => {
      const element = child as HTMLElement
      return element.hidden || getComputedStyle(element).display === 'none'
    })
    const blankFrames: number[] = []
    let watching = true

    const sample = (timestamp: number) => {
      if (!watching) return
      if (isBlank()) blankFrames.push(timestamp)
      requestAnimationFrame(sample)
    }

    Object.assign(window, {
      __navigationBlankFrames: blankFrames,
      __stopNavigationBlankWatch: () => {
        watching = false
      }
    })
    requestAnimationFrame(sample)
  })

  await page.getByRole('button', { name: '仪器设备', exact: true }).click()
  await expect(
    page.locator('.app-shell__main').getByRole('heading', {
      name: '仪器设备',
      exact: true
    })
  ).toBeVisible()

  const blankFrames = await page.evaluate(() => {
    const target = window as typeof window & {
      __navigationBlankFrames: number[]
      __stopNavigationBlankWatch: () => void
    }
    target.__stopNavigationBlankWatch()
    return target.__navigationBlankFrames
  })

  expect(blankFrames, '导航切换期间不应出现主区整帧空白').toHaveLength(0)
})
