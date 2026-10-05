import { expect, test } from '@playwright/test'
import { cableDevices, launchApp, openConsole, placeDevice, typeCommand } from './helpers'

test('configurer les IP en PowerShell puis pinger en invite de commandes', async () => {
  const { close, page, consoleErrors } = await launchApp()
  try {
    await placeDevice(page, 'server', 220, 160)
    await placeDevice(page, 'client', 220, 420)
    await placeDevice(page, 'switch', 520, 290)
    await cableDevices(page, 'SRV1', 'Ethernet0', 'SW1', 'Fa0/1')
    await cableDevices(page, 'PC1', 'Ethernet0', 'SW1', 'Fa0/2')

    // Serveur : PowerShell, complétion Tab puis New-NetIPAddress
    await openConsole(page, 'SRV1', 'powershell')
    const srv = page.getByTestId('device-window-SRV1')
    const input = srv.getByTestId('terminal-input')
    await input.fill('Get-NetAd')
    await input.press('Tab')
    await expect(input).toHaveValue('Get-NetAdapter')
    await input.press('Enter')
    await expect(srv.getByTestId('terminal-powershell')).toContainText('Carte réseau Ethernet virtuelle')
    await typeCommand(
      page,
      'SRV1',
      'New-NetIPAddress -InterfaceAlias Ethernet0 -IPAddress 192.168.1.1 -PrefixLength 24'
    )
    await expect(srv.getByTestId('terminal-powershell')).toContainText('PrefixOrigin      : Manual')
    await typeCommand(page, 'SRV1', 'Get-Truc')
    await expect(srv.getByTestId('terminal-powershell')).toContainText(
      "n'est pas reconnu comme nom d'applet de commande"
    )
    await srv.getByTestId('close-device-window').click()

    // Même source de vérité : le panneau Propriétés affiche l'adresse saisie en console
    await page.getByTestId('device-SRV1').click()
    await expect(page.getByTestId('properties-panel')).toContainText('192.168.1.1 / 255.255.255.0')

    // Poste : saisie interactive d'un paramètre obligatoire, puis ping
    await openConsole(page, 'PC1', 'powershell')
    await typeCommand(page, 'PC1', 'New-NetIPAddress -InterfaceAlias Ethernet0 -PrefixLength 24')
    const pc = page.getByTestId('device-window-PC1')
    await expect(pc.getByTestId('terminal-powershell')).toContainText(
      'Fournissez des valeurs pour les paramètres suivants'
    )
    await typeCommand(page, 'PC1', '192.168.1.10')
    await expect(pc.getByTestId('terminal-powershell')).toContainText('192.168.1.10')
    await openConsole(page, 'PC1', 'cmd')
    await typeCommand(page, 'PC1', 'ping 192.168.1.1')
    await expect(pc.getByTestId('terminal-cmd')).toContainText(
      'Réponse de 192.168.1.1 : octets=32 temps<1ms TTL=128'
    )
    await typeCommand(page, 'PC1', 'ipconfig')
    await expect(pc.getByTestId('terminal-cmd')).toContainText('Carte Ethernet Ethernet0 :')

    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})

test('Bureau : Gestionnaire de serveur et installation d’un rôle', async () => {
  const { close, page, consoleErrors } = await launchApp()
  try {
    await placeDevice(page, 'server', 300, 200)
    await page.getByTestId('device-SRV1').dblclick()
    const win = page.getByTestId('device-window-SRV1')
    await win.getByTestId('tab-desktop').click()
    await win.getByTestId('desktop-app-servermanager').dblclick()
    await win.getByTestId('add-roles').click()
    await win.getByTestId('role-DHCP').check()
    await win.getByTestId('install-roles').click()
    await expect(win.getByTestId('app-servermanager')).toContainText('Serveur DHCP')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
