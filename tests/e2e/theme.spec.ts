import { expect, test } from '@playwright/test'
import { clickMenu, launchApp, placeDevice } from './helpers'

test('Thème : sombre par défaut, bascule dans Affichage, conservé au relancement', async () => {
  const first = await launchApp()
  try {
    const html = first.page.locator('html')
    await expect(html).toHaveAttribute('data-theme', 'dark')
    await placeDevice(first.page, 'server', 300, 200)
    await clickMenu(first.app, ['Affichage', 'Thème clair'])
    await expect(html).toHaveAttribute('data-theme', 'light')
    // Le Bureau simulé garde son apparence claire quel que soit le thème
    await first.page.getByTestId('device-SRV1').dblclick()
    const win = first.page.getByTestId('device-window-SRV1')
    await win.getByTestId('tab-desktop').click()
    await expect(win.locator('[data-theme="light"]').first()).toBeVisible()
    expect(first.consoleErrors).toEqual([])
  } finally {
    await first.close()
  }

  const second = await launchApp({ userData: first.userData })
  try {
    await expect(second.page.locator('html')).toHaveAttribute('data-theme', 'light')
    await clickMenu(second.app, ['Affichage', 'Thème sombre'])
    await expect(second.page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(second.consoleErrors).toEqual([])
  } finally {
    await second.close()
  }
})
