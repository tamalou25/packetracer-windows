import { expect, test } from '@playwright/test'
import { launchApp, placeDevice } from './helpers'

test('Palette : recherche, groupes repliables, panneau rétractable', async () => {
  const { close, page, consoleErrors } = await launchApp()
  try {
    const palette = page.getByTestId('palette')
    await page.getByTestId('palette-search').fill('rout')
    await expect(palette.getByTestId('palette-router')).toBeVisible()
    await expect(palette.getByTestId('palette-server')).toHaveCount(0)
    await page.getByTestId('palette-search').fill('')

    // Groupe Réseau replié : switch et routeur masqués
    await page.getByTestId('palette-group-network').click()
    await expect(palette.getByTestId('palette-switch')).toHaveCount(0)
    await page.getByTestId('palette-group-network').click()
    await expect(palette.getByTestId('palette-switch')).toBeVisible()

    // Panneau replié : les équipements restent utilisables (icônes)
    await page.getByTestId('palette-toggle').click()
    await expect(palette).toHaveCSS('width', '44px')
    await placeDevice(page, 'server', 300, 200)
    await expect(page.getByTestId('device-SRV1')).toBeVisible()
    await page.getByTestId('palette-toggle').click()
    await expect(palette).toHaveCSS('width', '220px')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
