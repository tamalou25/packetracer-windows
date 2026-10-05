import { expect, test } from '@playwright/test'
import { domainLab, openLab } from './fixtures'
import { launchApp, openDesktop, typeCommand, unlock } from './helpers'

test('Fichiers : dossier, partage, NTFS, accès effectif puis accès depuis le poste', async () => {
  const lab = domainLab()
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await openLab(app, page, lab)

    // Serveur : dossier créé dans l'Explorateur
    const srv = await openDesktop(page, 'SRV1')
    await srv.getByTestId('maximize-device-window').click()
    // Explorateur épinglé dans la barre des tâches (le Gestionnaire de serveur couvre le Bureau)
    await srv.getByTestId('taskbar-explorer').click()
    const explorer = srv.getByTestId('app-explorer')
    await explorer.getByTestId('drive-C').dblclick()
    await expect(explorer.getByTestId('explorer-item-Windows')).toBeVisible()
    await explorer.getByTestId('explorer-new-folder').click()
    await explorer.getByTestId('explorer-name').fill('Compta')
    await explorer.getByTestId('explorer-name-ok').click()
    await expect(explorer.getByTestId('explorer-item-Compta')).toBeVisible()
    await explorer.getByTestId('window-close').click()

    // Gestionnaire de serveur : nouveau partage (Tout le monde : contrôle total, droits gérés par NTFS)
    const sm = srv.getByTestId('app-servermanager')
    await sm.getByTestId('sm-nav-FileAndStorage-Services').click()
    await sm.getByTestId('sm-new-share').click()
    const wizard = srv.getByTestId('app-newshare')
    await wizard.getByTestId('newshare-path').fill('C:\\Compta')
    await wizard.getByTestId('newshare-create').click()
    await expect(sm.getByTestId('sm-share-Compta')).toBeVisible()

    // Propriétés > Sécurité : héritage supprimé, Utilisateurs retiré, GG_Compta en modification
    await sm.getByTestId('sm-share-Compta').click()
    const props = srv.getByTestId('app-fileprops')
    await props.getByRole('tab', { name: 'Sécurité' }).click()
    await props.getByTestId('security-principal-BUILTIN\\Utilisateurs').click()
    await props.getByTestId('security-remove').click()
    await expect(props.getByTestId('security-message')).toContainText(
      'hérite des autorisations de son parent'
    )
    await props.getByTestId('security-message-ok').click()
    await props.getByTestId('security-advanced').click()
    await props.getByTestId('inheritance-convert').click()
    await expect(props.getByTestId('security-inheritance-state')).toContainText('désactivé')
    await props.getByTestId('security-principal-BUILTIN\\Utilisateurs').click()
    await props.getByTestId('security-remove').click()
    await expect(props.getByTestId('security-principal-BUILTIN\\Utilisateurs')).toHaveCount(0)
    await props.getByTestId('security-add-select').selectOption('LAB\\GG_Compta')
    await props.getByTestId('security-add').click()
    await props.getByTestId('security-allow-Modify').check()
    await expect(props.getByTestId('security-allow-Write')).toBeChecked()

    // Accès effectif : jdupont (GG_Compta) peut écrire, mmartin rien, via le partage
    await props.getByRole('tab', { name: 'Accès effectif' }).click()
    await props.getByTestId('effective-account').selectOption('LAB\\jdupont')
    await props.getByTestId('effective-share').selectOption('Compta')
    await props.getByTestId('effective-show').click()
    await expect(props.getByTestId('effective-write')).toContainText('✓')
    await expect(props.getByTestId('effective-changePermissions')).toContainText('Autorisations de fichiers')
    await props.getByTestId('effective-account').selectOption('LAB\\mmartin')
    await props.getByTestId('effective-show').click()
    await expect(props.getByTestId('effective-list')).toContainText('✗')
    await props.getByTestId('fileprops-ok').click()
    await srv.getByTestId('maximize-device-window').click()
    await srv.getByTestId('close-device-window').click()

    // Poste : jdupont connecte un lecteur réseau et crée un dossier
    await page.getByTestId('device-PC1').dblclick()
    const pc = page.getByTestId('device-window-PC1')
    await pc.getByTestId('tab-desktop').click()
    await unlock(page, 'PC1', 'Azerty123!', 'jdupont')
    await pc.getByTestId('desktop-icon-thispc').dblclick()
    const pcExplorer = pc.getByTestId('app-explorer')
    await pcExplorer.getByTestId('explorer-map-drive').click()
    await pcExplorer.getByTestId('map-letter').selectOption('S')
    await pcExplorer.getByTestId('map-path').fill('\\\\SRV1\\Compta')
    await pcExplorer.getByTestId('map-ok').click()
    await expect(pcExplorer.getByTestId('explorer-address')).toHaveValue('S:\\')
    await pcExplorer.getByTestId('explorer-new-folder').click()
    await pcExplorer.getByTestId('explorer-name').fill('Budget 2026')
    await pcExplorer.getByTestId('explorer-name-ok').click()
    await expect(pcExplorer.getByTestId('explorer-item-Budget 2026')).toBeVisible()
    await pcExplorer.getByTestId('window-close').click()

    // Invite de commandes : net use
    await pc.getByTestId('tab-console').click()
    await pc.getByTestId('console-cmd').click()
    await typeCommand(page, 'PC1', 'net use')
    await expect(pc.getByTestId('terminal-cmd')).toContainText('S:')
    await expect(pc.getByTestId('terminal-cmd')).toContainText('\\\\SRV1\\Compta')

    // mmartin : accès refusé au partage (aucune autorisation NTFS)
    await pc.getByTestId('tab-desktop').click()
    await pc.getByTestId('start-button').click()
    await pc.getByTestId('start-user').click()
    await pc.getByTestId('logoff').click()
    await unlock(page, 'PC1', 'Azerty123!', 'mmartin')
    await pc.getByTestId('desktop-icon-thispc').dblclick()
    await pc.getByTestId('explorer-address').fill('\\\\SRV1\\Compta')
    await pc.getByTestId('explorer-address').press('Enter')
    await expect(pc.getByTestId('explorer-message')).toContainText(
      'Vous n’avez pas l’autorisation d’accéder à \\\\SRV1\\Compta'
    )
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
