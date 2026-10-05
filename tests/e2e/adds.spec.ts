import { expect, test } from '@playwright/test'
import {
  cableDevices,
  configureHostIp,
  expectSignedIn,
  launchApp,
  openConsole,
  openDesktop,
  placeDevice,
  typeCommand,
  unlock
} from './helpers'

test('AD DS : promotion par l’assistant, OU et utilisateur, jonction du poste, ouverture de session', async () => {
  const { close, page, consoleErrors } = await launchApp()
  try {
    await placeDevice(page, 'server', 220, 160)
    await placeDevice(page, 'client', 220, 420)
    await placeDevice(page, 'switch', 520, 290)
    await cableDevices(page, 'SRV1', 'Ethernet0', 'SW1', 'Fa0/1')
    await cableDevices(page, 'PC1', 'Ethernet0', 'SW1', 'Fa0/2')
    await configureHostIp(page, 'SRV1', '192.168.10.1', '255.255.255.0', '', '127.0.0.1')
    await configureHostIp(page, 'PC1', '192.168.10.20', '255.255.255.0', '', '192.168.10.1')

    // Rôle AD DS en PowerShell, puis promotion depuis la notification du Gestionnaire de serveur
    await openConsole(page, 'SRV1', 'powershell')
    await typeCommand(page, 'SRV1', 'Install-WindowsFeature AD-Domain-Services -IncludeManagementTools')
    const srv = page.getByTestId('device-window-SRV1')
    await expect(srv.getByTestId('terminal-powershell')).toContainText('Services AD DS')
    await openDesktop(page, 'SRV1')
    const sm = srv.getByTestId('app-servermanager')
    await sm.getByTestId('sm-notifications').click()
    await sm.getByTestId('promote-dc').click()
    const wizard = srv.getByTestId('app-adpromote')
    await wizard.getByTestId('field-domain').fill('lab.local')
    await wizard.getByTestId('wiz-next').click()
    await wizard.getByTestId('field-password').fill('P@ssw0rd!')
    await wizard.getByTestId('field-confirm').fill('P@ssw0rd!')
    while (await wizard.getByTestId('promote-install').isDisabled())
      await wizard.getByTestId('wiz-next').click()
    await expect(wizard.getByTestId('promote-prereq')).toContainText('Toutes les vérifications')
    await wizard.getByTestId('promote-install').click()
    await srv.getByTestId('promote-signout').click()

    // Redémarrage : écran de verrouillage, session LAB\Administrateur à déverrouiller
    await expect(srv.getByTestId('logon-screen')).toBeVisible()
    await unlock(page, 'SRV1', 'P@ssw0rd')
    await expect(srv.getByTestId('app-servermanager')).toBeVisible()
    await srv.getByTestId('sm-nav-local').click()
    await expect(srv.getByTestId('sm-local-properties')).toContainText('lab.local')

    // Utilisateurs et ordinateurs AD : OU Compta + utilisateur
    await srv.getByTestId('sm-tools').click()
    await srv.getByTestId('sm-tool-aduc').click()
    const aduc = srv.getByTestId('app-aduc')
    await aduc.getByTestId('aduc-new-ou').click()
    await aduc.getByTestId('aduc-dialog').getByTestId('field-name').fill('Compta')
    await aduc.getByTestId('aduc-dialog').getByTestId('form-submit').click()
    await aduc.getByTestId('aduc-obj-Compta').dblclick()
    await aduc.getByTestId('aduc-new-user').click()
    const u = aduc.getByTestId('aduc-dialog')
    await u.getByTestId('field-given').fill('Jean')
    await u.getByTestId('field-surname').fill('Dupont')
    await u.getByTestId('field-sam').fill('jdupont')
    await u.getByTestId('field-password').fill('Azerty123!')
    await u.getByTestId('field-confirm').fill('Azerty123!')
    await u.getByTestId('field-mustChange').uncheck()
    await u.getByTestId('form-submit').click()
    await expect(aduc.getByTestId('aduc-objects')).toContainText('Jean Dupont')
    await srv.getByTestId('close-device-window').click()

    // Poste : Propriétés système (recherche « sysdm.cpl »), jonction au domaine
    const pc = await openDesktop(page, 'PC1')
    await pc.getByTestId('search-input').fill('sysdm.cpl')
    await pc.getByTestId('search-input').press('Enter')
    await pc.getByTestId('sysdm-change').click()
    const nameDialog = pc.getByTestId('app-sysdmname')
    await nameDialog.getByTestId('sysdm-domain-radio').check()
    await nameDialog.getByTestId('join-domain').fill('lab.local')
    await nameDialog.getByTestId('sysdm-name-ok').click()
    await nameDialog.getByTestId('join-credentials').getByTestId('field-user').fill('LAB\\Administrateur')
    await nameDialog.getByTestId('join-credentials').getByTestId('field-password').fill('P@ssw0rd')
    await nameDialog.getByTestId('join-credentials').getByTestId('form-submit').click()
    await expect(nameDialog.getByTestId('msgbox')).toContainText('Bienvenue dans le domaine lab.local')
    await nameDialog.getByTestId('msgbox-ok').click()
    await pc.getByTestId('sysdm-ok').click()
    await pc.getByTestId('restart-now').click()

    // Écran de connexion du domaine : mauvais mot de passe puis connexion réussie
    await expect(pc.getByTestId('logon-screen')).toBeVisible()
    await pc.getByTestId('send-cad').click()
    await expect(pc.getByTestId('logon-target')).toContainText('LAB')
    await pc.getByTestId('logon-user').fill('jdupont')
    await pc.getByTestId('logon-password').fill('faux')
    await pc.getByTestId('logon-submit').click()
    await expect(pc.getByTestId('logon-error')).toContainText('incorrect')
    await pc.getByTestId('logon-error-ok').click()
    await pc.getByTestId('logon-password').fill('Azerty123!')
    await pc.getByTestId('logon-submit').click()
    await expectSignedIn(page, 'PC1')

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
