import { expect, test } from '@playwright/test'
import { cableDevices, launchApp, openDesktop, placeDevice, unlock } from './helpers'

test('Bureau : menus, fenêtres, Exécuter, propriétés IPv4, verrouillage et redémarrage', async () => {
  const { close, page, consoleErrors } = await launchApp()
  try {
    await placeDevice(page, 'server', 240, 200)
    await placeDevice(page, 'switch', 520, 300)
    await cableDevices(page, 'SRV1', 'Ethernet0', 'SW1', 'Fa0/1')
    const win = await openDesktop(page, 'SRV1')
    await win.getByTestId('maximize-device-window').click()

    // Gestionnaire de serveur ouvert automatiquement ; PowerShell depuis le menu Démarrer
    await expect(win.getByTestId('app-servermanager')).toBeVisible()
    await win.getByTestId('start-button').click()
    await win.getByTestId('start-app-powershell').click()
    const ps = win.getByTestId('app-powershell')
    await ps.getByTestId('terminal-input').fill('hostname')
    await ps.getByTestId('terminal-input').press('Enter')
    await expect(ps.getByTestId('terminal-powershell')).toContainText('SRV1')
    await ps.getByTestId('window-minimize').click()
    await expect(ps).toBeHidden()
    await win.getByTestId('taskbar-powershell').click()
    await expect(ps).toBeVisible()

    // Exécuter (clic droit sur Démarrer) : commande inconnue, puis ncpa.cpl
    await win.getByTestId('start-button').click({ button: 'right' })
    await win.getByTestId('winx-run').click()
    await win.getByTestId('run-input').fill('truc.cpl')
    await win.getByTestId('run-ok').click()
    await expect(win.getByTestId('desktop-notice')).toContainText('Impossible de trouver « truc.cpl »')
    await win.getByTestId('notice-ok').click()
    await win.getByTestId('start-button').click({ button: 'right' })
    await win.getByTestId('winx-run').click()
    await win.getByTestId('run-input').fill('ncpa.cpl')
    await win.getByTestId('run-ok').click()

    // Connexions réseau → Propriétés → TCP/IPv4 : adresse statique, passerelle hors réseau
    const ncpa = win.getByTestId('app-ncpa')
    await expect(ncpa.getByTestId('ncpa-adapter-Ethernet0')).toContainText('Réseau non identifié')
    await ncpa.getByTestId('ncpa-adapter-Ethernet0').click()
    await ncpa.getByTestId('ncpa-properties').click()
    await win.getByTestId('app-netprops').getByTestId('netprops-properties').click()
    const ipv4 = win.getByTestId('app-ipv4')
    await ipv4.getByTestId('ipv4-static').check()
    await ipv4.getByTestId('ipv4-address-0').fill('192.168.10.5')
    // Le masque par défaut de la classe est proposé à l'entrée dans le champ
    await ipv4.getByTestId('ipv4-mask-0').click()
    await expect(ipv4.getByTestId('ipv4-mask-0')).toHaveValue('255')
    await ipv4.getByTestId('ipv4-gateway-0').fill('192.168.20.1')
    await ipv4.getByTestId('ipv4-ok').click()
    await expect(ipv4.getByTestId('ipv4-msgbox')).toContainText('même segment réseau')
    await ipv4.getByTestId('ipv4-msgbox-yes').click()
    await expect(ipv4).toBeHidden()
    await expect(ncpa.getByTestId('ncpa-adapter-Ethernet0')).not.toContainText('Réseau non identifié')
    await win.getByTestId('app-netprops').getByTestId('netprops-ok').click()

    // Verrouillage : mauvais mot de passe, puis déverrouillage
    await win.getByTestId('start-button').click()
    await win.getByTestId('start-user').click()
    await win.getByTestId('user-lock').click()
    await unlock(page, 'SRV1', 'faux')
    await expect(win.getByTestId('logon-error')).toContainText('incorrect')
    await win.getByTestId('logon-error-ok').click()
    await win.getByTestId('logon-password').fill('P@ssw0rd')
    await win.getByTestId('logon-submit').click()
    await expect(ncpa).toBeVisible()

    // Redémarrage avec la raison demandée par le serveur : fenêtres fermées, écran de verrouillage
    await win.getByTestId('start-button').click()
    await win.getByTestId('start-power').click()
    await win.getByTestId('power-restart').click()
    await win.getByTestId('shutdown-reason').selectOption('Application : maintenance (planifiée)')
    await win.getByTestId('shutdown-continue').click()
    await expect(win.getByTestId('logon-screen')).toBeVisible()
    await unlock(page, 'SRV1', 'P@ssw0rd')
    await expect(ncpa).toHaveCount(0)
    await expect(win.getByTestId('app-servermanager')).toBeVisible()

    // Le panneau Propriétés reflète la configuration faite depuis le Bureau (même source de vérité)
    await win.getByTestId('maximize-device-window').click()
    await win.getByTestId('close-device-window').click()
    await page.getByTestId('device-SRV1').click()
    await expect(page.getByTestId('properties-panel')).toContainText('192.168.10.5 / 255.255.255.0')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
