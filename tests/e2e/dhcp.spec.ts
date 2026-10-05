import { expect, test } from '@playwright/test'
import { cableDevices, configureHostIp, launchApp, openConsole, placeDevice, typeCommand } from './helpers'

test('DHCP : étendue créée dans la console, le poste obtient une adresse (DORA visible en simulation)', async () => {
  const { close, page, consoleErrors } = await launchApp()
  try {
    await placeDevice(page, 'server', 220, 160)
    await placeDevice(page, 'client', 220, 420)
    await placeDevice(page, 'switch', 520, 290)
    await cableDevices(page, 'SRV1', 'Ethernet0', 'SW1', 'Fa0/1')
    await cableDevices(page, 'PC1', 'Ethernet0', 'SW1', 'Fa0/2')
    await configureHostIp(page, 'SRV1', '192.168.10.1', '255.255.255.0')

    // Rôle DHCP en PowerShell, étendue via la console graphique
    await openConsole(page, 'SRV1', 'powershell')
    await typeCommand(page, 'SRV1', 'Install-WindowsFeature DHCP -IncludeManagementTools')
    const srv = page.getByTestId('device-window-SRV1')
    await expect(srv.getByTestId('terminal-powershell')).toContainText('Serveur DHCP')
    await srv.getByTestId('tab-desktop').click()
    await srv.getByTestId('desktop-app-dhcp').dblclick()
    await srv.getByTestId('dhcp-new-scope').click()
    await srv.getByTestId('scope-name').fill('LAN')
    await srv.getByTestId('scope-start').fill('192.168.10.100')
    await srv.getByTestId('scope-end').fill('192.168.10.150')
    await srv.getByTestId('scope-router').fill('192.168.10.254')
    await srv.getByTestId('scope-create').click()
    await expect(srv.getByTestId('dhcp-console')).toContainText('Étendue [192.168.10.0] LAN')

    // Temps réel : le poste (en DHCP par défaut) obtient un bail automatiquement
    await srv.getByTestId('close-device-window').click()
    await page.getByTestId('device-PC1').click()
    await expect(page.getByTestId('properties-panel')).toContainText('192.168.10.100 / 255.255.255.0')

    // Simulation : ipconfig /release puis /renew → échange DORA rejoué pas à pas
    await openConsole(page, 'PC1', 'cmd')
    await typeCommand(page, 'PC1', 'ipconfig /release')
    await page.getByTestId('mode-simulation').click()
    await typeCommand(page, 'PC1', 'ipconfig /renew')
    for (let i = 0; i < 20; i++) {
      if (await page.getByTestId('sim-step').isDisabled()) break
      await page.getByTestId('sim-step').click()
    }
    const events = page.getByTestId('sim-events')
    await expect(events).toContainText('DHCP')
    const pc = page.getByTestId('device-window-PC1')
    await expect(pc.getByTestId('terminal-cmd')).toContainText('192.168.10.100')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
