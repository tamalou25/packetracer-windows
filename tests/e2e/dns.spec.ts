import { expect, test } from '@playwright/test'
import { cableDevices, configureHostIp, launchApp, openConsole, placeDevice, typeCommand } from './helpers'

test('DNS : zone et hôte créés dans le gestionnaire DNS, nslookup et ping par nom', async () => {
  const { close, page, consoleErrors } = await launchApp()
  try {
    await placeDevice(page, 'server', 220, 160)
    await placeDevice(page, 'client', 220, 420)
    await placeDevice(page, 'switch', 520, 290)
    await cableDevices(page, 'SRV1', 'Ethernet0', 'SW1', 'Fa0/1')
    await cableDevices(page, 'PC1', 'Ethernet0', 'SW1', 'Fa0/2')
    await configureHostIp(page, 'SRV1', '192.168.10.1', '255.255.255.0', '', '127.0.0.1')
    await configureHostIp(page, 'PC1', '192.168.10.20', '255.255.255.0', '', '192.168.10.1')

    await openConsole(page, 'SRV1', 'powershell')
    await typeCommand(page, 'SRV1', 'Install-WindowsFeature DNS -IncludeManagementTools')
    const srv = page.getByTestId('device-window-SRV1')
    await expect(srv.getByTestId('terminal-powershell')).toContainText('Serveur DNS')
    await srv.getByTestId('tab-desktop').click()
    await srv.getByTestId('desktop-app-dns').dblclick()
    await srv.getByTestId('dns-new-zone').click()
    await srv.getByTestId('field-value').fill('lab.local')
    await srv.getByTestId('form-submit').click()
    await expect(srv.getByTestId('dns-records')).toContainText('Serveur de noms (NS)')
    await srv.getByTestId('dns-new-a').click()
    await srv.getByTestId('field-name').fill('intranet')
    await srv.getByTestId('field-data').fill('192.168.10.1')
    await srv.getByTestId('form-submit').click()
    await expect(srv.getByTestId('dns-records')).toContainText('intranet')
    await srv.getByTestId('close-device-window').click()

    await openConsole(page, 'PC1', 'cmd')
    await typeCommand(page, 'PC1', 'nslookup intranet.lab.local')
    const pc = page.getByTestId('device-window-PC1').getByTestId('terminal-cmd')
    await expect(pc).toContainText('Serveur :   UnKnown')
    await expect(pc).toContainText('Nom :    intranet.lab.local')
    await typeCommand(page, 'PC1', 'ping intranet.lab.local')
    await expect(pc).toContainText("Envoi d’une requête 'ping' sur intranet.lab.local [192.168.10.1]")
    await expect(pc).toContainText('Réponse de 192.168.10.1')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
