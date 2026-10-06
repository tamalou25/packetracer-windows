import { expect, test } from '@playwright/test'
import { clickMenu, launchApp, placeDevice } from './helpers'

test('Vue : zoom regroupé avec la minimap, minimap masquable', async () => {
  const { app, close, page, consoleErrors, userData } = await launchApp()
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

    // Molette : zoom sur le canvas ; Affichage > Ajuster à la fenêtre (Ctrl+0)
    await page.locator('.react-flow__pane').hover({ position: { x: 400, y: 300 } })
    await page.mouse.wheel(0, -400)
    await expect(level).not.toHaveText('100 %')
    const zoomed = await level.textContent()
    await clickMenu(app, ['Affichage', 'Ajuster à la fenêtre'])
    await expect(level).not.toHaveText(zoomed ?? '')

    // Minimap masquée : préférence conservée au relancement
    await page.getByTestId('minimap-toggle').click()
    await expect(minimap).toHaveCount(0)
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }

  const again = await launchApp({ userData })
  try {
    await expect(again.page.getByTestId('zoom-level')).toBeVisible()
    await expect(again.page.locator('.react-flow__minimap')).toHaveCount(0)
    expect(again.consoleErrors).toEqual([])
  } finally {
    await again.close()
  }
})
