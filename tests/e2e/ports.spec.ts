import { expect, test } from '@playwright/test'
import { launchApp, placeDevice } from './helpers'

test('Ports : noms visibles au survol, câblage direct depuis le panneau de ports', async () => {
  const { close, page, consoleErrors } = await launchApp()
  try {
    await placeDevice(page, 'server', 240, 200)
    await placeDevice(page, 'switch', 560, 300)

    // Survol (outil Sélection) : liste des ports nommés, en lecture seule
    await page.getByTestId('device-SW1').hover()
    const tray = page.getByTestId('port-tray-SW1')
    await expect(tray).toBeVisible()
    await expect(tray).toContainText('Fa0/1')
    await expect(tray).toContainText('Fa0/16')
    await expect(tray).toContainText('16/16 libres')

    // Mode Câble : clic sur un port libre de chaque équipement
    await page.getByTestId('tool-cable').click()
    await page.getByTestId('device-SRV1').hover()
    await page.getByTestId('port-tray-SRV1').getByTestId('port-chip-Ethernet0').click()
    await page.getByTestId('device-SW1').hover()
    await page.getByTestId('port-tray-SW1').getByTestId('port-chip-Fa0/5').click()

    const panel = page.getByTestId('properties-panel')
    await expect(panel).toContainText('Câble Ethernet')
    await expect(panel).toContainText('Fa0/5')
    await expect(panel).toContainText('Ethernet0')

    // Le port utilisé n'est plus proposé
    await page.getByTestId('device-SW1').hover()
    await expect(page.getByTestId('port-tray-SW1').getByTestId('port-chip-Fa0/5')).toBeDisabled()
    await expect(page.getByTestId('port-tray-SW1')).toContainText('15/16 libres')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
