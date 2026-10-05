import { expect, test } from '@playwright/test'
import { cableDevices, configureHostIp, launchApp, openConsole, placeDevice, typeCommand } from './helpers'

test('AD DS : promotion, OU et utilisateur dans la console, jonction du poste, ouverture de session', async () => {
  const { close, page, consoleErrors } = await launchApp()
  try {
    await placeDevice(page, 'server', 220, 160)
    await placeDevice(page, 'client', 220, 420)
    await placeDevice(page, 'switch', 520, 290)
    await cableDevices(page, 'SRV1', 'Ethernet0', 'SW1', 'Fa0/1')
    await cableDevices(page, 'PC1', 'Ethernet0', 'SW1', 'Fa0/2')
    await configureHostIp(page, 'SRV1', '192.168.10.1', '255.255.255.0', '', '127.0.0.1')
    await configureHostIp(page, 'PC1', '192.168.10.20', '255.255.255.0', '', '192.168.10.1')

    // Rôle AD DS puis promotion via l'assistant du Gestionnaire de serveur
    await openConsole(page, 'SRV1', 'powershell')
    await typeCommand(page, 'SRV1', 'Install-WindowsFeature AD-Domain-Services -IncludeManagementTools')
    const srv = page.getByTestId('device-window-SRV1')
    await expect(srv.getByTestId('terminal-powershell')).toContainText('Services AD DS')
    await srv.getByTestId('tab-desktop').click()
    await srv.getByTestId('desktop-app-servermanager').dblclick()
    await srv.getByTestId('promote-dc').click()
    const dlg = srv.getByTestId('promote-dialog')
    await dlg.getByTestId('field-domain').fill('lab.local')
    await dlg.getByTestId('field-password').fill('P@ssw0rd!')
    await dlg.getByTestId('field-confirm').fill('P@ssw0rd!')
    await dlg.getByTestId('form-submit').click()
    await expect(srv.getByTestId('app-servermanager')).toContainText('lab.local')

    // Utilisateurs et ordinateurs AD : OU Compta + utilisateur
    await srv.getByTestId('close-app').click()
    await srv.getByTestId('desktop-app-aduc').dblclick()
    await srv.getByTestId('aduc-new-ou').click()
    await srv.getByTestId('aduc-dialog').getByTestId('field-name').fill('Compta')
    await srv.getByTestId('aduc-dialog').getByTestId('form-submit').click()
    await srv.getByTestId('aduc-obj-Compta').dblclick()
    await srv.getByTestId('aduc-new-user').click()
    const u = srv.getByTestId('aduc-dialog')
    await u.getByTestId('field-given').fill('Jean')
    await u.getByTestId('field-surname').fill('Dupont')
    await u.getByTestId('field-sam').fill('jdupont')
    await u.getByTestId('field-password').fill('Azerty123!')
    await u.getByTestId('field-confirm').fill('Azerty123!')
    await u.getByTestId('field-mustChange').uncheck()
    await u.getByTestId('form-submit').click()
    await expect(srv.getByTestId('aduc-objects')).toContainText('Jean Dupont')
    await srv.getByTestId('close-device-window').click()

    // Poste : jonction au domaine depuis l'application Système
    await page.getByTestId('device-PC1').dblclick()
    const pc = page.getByTestId('device-window-PC1')
    await pc.getByTestId('tab-desktop').click()
    await pc.getByTestId('desktop-app-system').dblclick()
    await pc.getByTestId('join-domain').fill('lab.local')
    await pc.getByTestId('join-submit').click()
    await pc.getByTestId('join-credentials').getByTestId('field-user').fill('LAB\\Administrateur')
    await pc.getByTestId('join-credentials').getByTestId('field-password').fill('P@ssw0rd')
    await pc.getByTestId('join-credentials').getByTestId('form-submit').click()
    await expect(page.getByTestId('modal')).toContainText('Bienvenue dans le domaine lab.local')
    await page.getByTestId('modal-confirm').click()
    await pc.getByTestId('system-restart').click()

    // Écran de connexion : mauvais mot de passe puis connexion réussie
    await expect(pc.getByTestId('logon-screen')).toBeVisible()
    await pc.getByTestId('logon-user').fill('jdupont')
    await pc.getByTestId('logon-password').fill('faux')
    await pc.getByTestId('logon-submit').click()
    await expect(pc.getByTestId('logon-error')).toContainText('incorrect')
    await pc.getByTestId('logon-password').fill('Azerty123!')
    await pc.getByTestId('logon-submit').click()
    await expect(pc.getByTestId('logoff')).toBeVisible()
    await expect(pc).toContainText('LAB\\jdupont')

    await pc.getByTestId('tab-console').click()
    await pc.getByTestId('console-cmd').click()
    await typeCommand(page, 'PC1', 'whoami')
    await expect(pc.getByTestId('terminal-cmd')).toContainText('lab\\jdupont')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})

test('AD DS : promotion depuis PowerShell, la console garde la sortie et rouvre la session', async () => {
  const { close, page, consoleErrors } = await launchApp()
  try {
    await placeDevice(page, 'server', 260, 200)
    await placeDevice(page, 'switch', 520, 290)
    await cableDevices(page, 'SRV1', 'Ethernet0', 'SW1', 'Fa0/1')
    await configureHostIp(page, 'SRV1', '192.168.10.1', '255.255.255.0', '', '127.0.0.1')
    await openConsole(page, 'SRV1', 'powershell')
    await typeCommand(page, 'SRV1', 'Install-WindowsFeature AD-Domain-Services -IncludeManagementTools')
    await typeCommand(
      page,
      'SRV1',
      'Install-ADDSForest -DomainName lab.local -SafeModeAdministratorPassword (ConvertTo-SecureString "P@ssw0rd!" -AsPlainText -Force) -Force'
    )
    const term = page.getByTestId('device-window-SRV1').getByTestId('terminal-powershell')
    await expect(term).toContainText('L’opération a réussi.')
    await expect(term).toContainText('[Session fermée — nouvelle session ouverte]')
    await typeCommand(page, 'SRV1', 'whoami')
    await expect(term).toContainText('lab\\administrateur')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
