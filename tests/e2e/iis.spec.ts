import { expect, test } from '@playwright/test'
import {
  cableDevices,
  configureHostIp,
  launchApp,
  openConsole,
  openDesktop,
  openTool,
  placeDevice,
  typeCommand
} from './helpers'

test('IIS : site par défaut consulté depuis le navigateur d’un poste, site ajouté dans le Gestionnaire IIS', async () => {
  const { close, page, consoleErrors } = await launchApp()
  try {
    await placeDevice(page, 'server', 220, 160)
    await placeDevice(page, 'client', 220, 420)
    await placeDevice(page, 'switch', 520, 290)
    await cableDevices(page, 'SRV1', 'Ethernet0', 'SW1', 'Fa0/1')
    await cableDevices(page, 'PC1', 'Ethernet0', 'SW1', 'Fa0/2')
    await configureHostIp(page, 'SRV1', '192.168.10.1', '255.255.255.0')
    await configureHostIp(page, 'PC1', '192.168.10.10', '255.255.255.0')

    await openConsole(page, 'SRV1', 'powershell')
    await typeCommand(page, 'SRV1', 'Install-WindowsFeature Web-Server -IncludeManagementTools')
    const srv = page.getByTestId('device-window-SRV1')
    await expect(srv.getByTestId('terminal-powershell')).toContainText('Serveur Web (IIS)')

    // Gestionnaire IIS : nouveau site sur le port 8080 (dossier racine du site par défaut)
    await openTool(page, 'SRV1', 'inetmgr')
    await srv.getByTestId('iis-new-site').click()
    const dialog = srv.getByTestId('iis-site-dialog')
    const inputs = dialog.locator('input')
    await inputs.nth(0).fill('Test')
    await inputs.nth(1).fill('C:\\inetpub\\wwwroot')
    await inputs.nth(3).fill('8080')
    await dialog.getByRole('button', { name: 'OK' }).click()
    await expect(srv.getByTestId('iis-bindings')).toContainText('8080')
    // Port personnalisé : le rôle n'ouvre que 80 et 443, une règle de pare-feu est nécessaire
    await openConsole(page, 'SRV1', 'powershell')
    await typeCommand(
      page,
      'SRV1',
      'New-NetFirewallRule -DisplayName "Site Test" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow'
    )
    await expect(srv.getByTestId('terminal-powershell')).toContainText('Site Test')
    await srv.getByTestId('close-device-window').click()

    // Navigateur du poste
    const pc = await openDesktop(page, 'PC1')
    await pc.getByTestId('start-button').click()
    await pc.getByTestId('start-app-browser').click()
    await pc.getByTestId('browser-address').fill('http://192.168.10.1:8080')
    await pc.getByTestId('browser-go').click()
    await expect(pc.getByTestId('browser-content')).toContainText(
      'Page d’accueil par défaut du site « Test »'
    )
    await pc.getByTestId('browser-address').fill('http://192.168.10.1/absent.html')
    await pc.getByTestId('browser-go').click()
    await expect(pc.getByTestId('browser-content')).toContainText('404 - Not Found')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
