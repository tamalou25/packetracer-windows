import { expect, test } from '@playwright/test'
import { clickMenu, launchApp, placeDevice } from './helpers'

test('Vue : zoom regroupé avec la minimap, minimap masquable', async () => {
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await placeDevice(page, 'server', 300, 200)
    const level = page.getByTestId('zoom-level')
    await expect(level).toHaveText('100 %')
    await page.getByTestId('zoom-in').click()
    await expect(level).not.toHaveText('100 %')
    await level.click()
    await expect(level).toHaveText('100 %')

    const minimap = page.locator('.react-flow__minimap')
    await expect(minimap).toBeVisible()
    await page.getByTestId('minimap-toggle').click()
    await expect(minimap).toHaveCount(0)
    await clickMenu(app, ['Affichage', 'Afficher la minimap'])
    await expect(minimap).toBeVisible()
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
