import { expect, test } from '@playwright/test'
import { cableDevices, configureHostIp, launchApp, placeDevice } from './helpers'

test('ping par PDU simple en temps réel puis en mode Simulation', async () => {
  const { close, page, consoleErrors } = await launchApp()
  try {
    await placeDevice(page, 'server', 220, 160)
    await placeDevice(page, 'client', 220, 420)
    await placeDevice(page, 'switch', 520, 290)
    await cableDevices(page, 'SRV1', 'Ethernet0', 'SW1', 'Port 1')
    await cableDevices(page, 'PC1', 'Ethernet0', 'SW1', 'Port 2')
    await configureHostIp(page, 'SRV1', '192.168.10.1', '255.255.255.0')
    await configureHostIp(page, 'PC1', '192.168.10.20', '255.255.255.0', '192.168.10.254')

    // Temps réel : résultat immédiat
    await page.getByTestId('tool-pdu').click()
    await page.getByTestId('device-PC1').click()
    await page.getByTestId('device-SRV1').click()
    await expect(page.getByTestId('pdu-list')).toContainText('Réussi')
    await expect(page.getByTestId('pdu-list')).toContainText('SRV1 (192.168.10.1)')

    // Simulation : les paquets sont rejoués pas à pas
    await page.getByTestId('mode-simulation').click()
    await page.getByTestId('device-PC1').click()
    await page.getByTestId('device-SRV1').click()
    await expect(page.getByTestId('simulation-panel')).toBeVisible()
    await expect(page.getByTestId('pdu-list').getByText('Réussi')).toHaveCount(1)
    for (let i = 0; i < 12; i++) {
      if (await page.getByTestId('sim-step').isDisabled()) break
      await page.getByTestId('sim-step').click()
    }
    await expect(page.getByTestId('pdu-list').getByText('Réussi')).toHaveCount(2)
    const rows = page.getByTestId('sim-events').locator('tbody tr')
    await expect(rows.first()).toContainText('ARP')
    await expect(rows.filter({ hasText: 'ICMP' }).first()).toBeVisible()
    await expect(page.getByTestId('pdu-details')).toBeVisible()

    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
