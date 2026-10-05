import { expect, test } from '@playwright/test'
import { cableDevices, configureHostIp, launchApp, placeDevice } from './helpers'

test('Nœuds : IP principale, LED d’état (opérationnel, à vérifier, non raccordé, éteint)', async () => {
  const { close, page, consoleErrors } = await launchApp()
  try {
    await placeDevice(page, 'server', 240, 160)
    await placeDevice(page, 'switch', 520, 290)
    await placeDevice(page, 'client', 240, 420)
    await placeDevice(page, 'client', 600, 440)
    await cableDevices(page, 'SRV1', 'Ethernet0', 'SW1', 'Fa0/1')
    await cableDevices(page, 'PC1', 'Ethernet0', 'SW1', 'Fa0/2')

    const srv = page.getByTestId('device-SRV1')
    // Carte raccordée mais sans adresse statique ni serveur DHCP : APIPA, LED orange
    await expect(srv).toHaveAttribute('data-health', 'warn')
    await configureHostIp(page, 'SRV1', '192.168.10.1', '255.255.255.0')
    await expect(srv).toContainText('192.168.10.1/24')
    await expect(srv).toHaveAttribute('data-health', 'ok')

    // Poste en DHCP sans serveur : adresse APIPA signalée
    await expect(page.getByTestId('device-PC1')).toHaveAttribute('data-health', 'warn')
    await expect(page.getByTestId('device-PC1')).toContainText('169.254.')

    // Poste non raccordé : pas d'adresse automatique affichée
    const pc2 = page.getByTestId('device-PC2')
    await expect(pc2).toHaveAttribute('data-health', 'idle')
    await expect(pc2).toContainText('sans IP')

    // Équipement éteint
    await srv.click()
    await page.getByTestId('properties-panel').getByRole('button', { name: 'Éteindre' }).click()
    await expect(srv).toHaveAttribute('data-health', 'off')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
