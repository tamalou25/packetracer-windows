import { expect, test } from '@playwright/test'
import { cableDevices, launchApp, placeDevice } from './helpers'

test('Barre d’état : compteurs, enregistrement, thème et mode', async () => {
  const { close, page, consoleErrors } = await launchApp()
  try {
    const bar = page.getByTestId('status-bar')
    await expect(page.getByTestId('status-counts')).toHaveText('0 équipement · 0 lien')
    await expect(page.getByTestId('status-save')).toContainText('Nouveau document')

    await placeDevice(page, 'server', 240, 200)
    await placeDevice(page, 'switch', 520, 300)
    await cableDevices(page, 'SRV1', 'Ethernet0', 'SW1', 'Fa0/1')
    await expect(page.getByTestId('status-counts')).toHaveText('2 équipements · 1 lien')
    await expect(page.getByTestId('status-save')).toContainText('Modifié')
    await expect(page.getByTestId('status-zoom')).toHaveText('100 %')

    // Bascule sombre ↔ clair depuis le thème appliqué (Système au premier lancement)
    const html = page.locator('html')
    const initial = await html.getAttribute('data-theme')
    const other = initial === 'dark' ? 'light' : 'dark'
    await page.getByTestId('status-theme').click()
    await expect(html).toHaveAttribute('data-theme', other)
    await page.getByTestId('status-theme').click()
    await expect(html).toHaveAttribute('data-theme', initial ?? 'dark')

    await page.getByTestId('mode-simulation').click()
    await expect(bar).toContainText('Aucun paquet en attente')
    await page.getByTestId('mode-realtime').click()
    await expect(bar).not.toContainText('Aucun paquet en attente')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
