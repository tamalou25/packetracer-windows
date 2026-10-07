import { expect, test } from '@playwright/test'
import { DEFAULT_DOMAIN_POLICY_ID } from '../../src/engine/index'
import { domainLab, openLab } from './fixtures'
import { launchApp, openTool, unlock } from './helpers'

test('GPO : console, éditeur, application à l’ouverture de session, gpupdate et gpresult', async () => {
  const lab = domainLab()
  const ouId = lab.domains['lab.local']?.containers.find((c) => c.name === 'Compta')?.id ?? ''
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await openLab(app, page, lab)

    // Contrôleur : console Gestion des stratégies de groupe, GPO créée et liée à l'OU Compta
    await openTool(page, 'SRV1', 'gpmc')
    const srv = page.getByTestId('device-window-SRV1')
    await srv.getByTestId('maximize-device-window').click()
    const gpmc = srv.getByTestId('app-gpmc')
    await gpmc.getByTestId(`mmc-node-ou|${ouId}`).click()
    await gpmc.getByTestId('gpmc-create-link').click()
    await gpmc.getByTestId('gpmc-name').fill('GPO-Compta')
    await gpmc.getByTestId('gpmc-dialog-ok').click()
    await expect(gpmc.getByTestId('gpmc-scope-links')).toContainText('lab.local/Compta')

    // Éditeur : Panneau de configuration interdit, papier peint, lecteur réseau
    await gpmc.getByTestId('gpmc-edit').click()
    let gpme = srv.getByTestId('app-gpme')
    await gpme.getByTestId('mmc-node-u-control').click()
    await gpme.getByTestId('gpme-setting-noControlPanel').dblclick()
    await gpme.getByTestId('policy-enabled').check()
    await gpme.getByTestId('policy-ok').click()
    await expect(gpme.getByTestId('gpme-state-noControlPanel')).toHaveText('Activé')
    await gpme.getByTestId('mmc-node-u-desktop-desktop').click()
    await gpme.getByTestId('gpme-setting-wallpaper').dblclick()
    await gpme.getByTestId('policy-enabled').check()
    await gpme.getByTestId('policy-wallpaper-path').fill('C:\\Windows\\Web\\Wallpaper\\ServerLab\\aurore.jpg')
    await gpme.getByTestId('policy-ok').click()
    await gpme.getByTestId('mmc-node-u-drivemaps').click()
    await gpme.getByTestId('gpme-new-drive').click()
    await gpme.getByTestId('drive-path').fill('\\\\SRV1\\Compta')
    await gpme.getByTestId('drive-label').fill('Compta')
    await gpme.getByTestId('drive-letter').selectOption('S')
    await gpme.getByTestId('drive-ok').click()
    await expect(gpme.getByTestId('gpme-drive-S')).toBeVisible()
    await gpme.getByTestId('window-close').click()

    // Default Domain Policy : message affiché avant l'ouverture de session (stratégie d'ordinateur)
    await gpmc.getByTestId(`mmc-node-link|root|${DEFAULT_DOMAIN_POLICY_ID}`).click()
    await gpmc.getByTestId('gpmc-edit').click()
    gpme = srv.getByTestId('app-gpme')
    await gpme.getByTestId('mmc-node-c-secopts').click()
    await gpme.getByTestId('gpme-setting-logonMessageTitle').dblclick()
    await gpme.getByTestId('policy-define').check()
    await gpme.getByTestId('policy-text').fill('Avertissement')
    await gpme.getByTestId('policy-ok').click()
    await gpme.getByTestId('gpme-setting-logonMessageText').dblclick()
    await gpme.getByTestId('policy-define').check()
    await gpme.getByTestId('policy-text').fill('Accès réservé au personnel autorisé.')
    await gpme.getByTestId('policy-ok').click()
    await expect(gpme.getByTestId('gpme-state-logonMessageTitle')).toHaveText('Avertissement')
    await srv.getByTestId('maximize-device-window').click()
    await srv.getByTestId('close-device-window').click()

    // Poste : ouverture de session de jdupont, effets de la GPO
    await page.getByTestId('device-PC1').dblclick()
    const pc = page.getByTestId('device-window-PC1')
    await pc.getByTestId('tab-desktop').click()
    await unlock(page, 'PC1', 'Azerty123!', 'jdupont')
    await expect(pc.getByTestId('taskbar')).toBeVisible()
    await expect(pc.locator('[data-wallpaper="aurore"]')).toBeVisible()
    await pc.getByTestId('start-button').click({ button: 'right' })
    await pc.getByTestId('winx-control').click()
    await expect(pc.getByTestId('desktop-notice')).toContainText('restrictions en vigueur sur cet ordinateur')
    await pc.getByTestId('notice-ok').click()
    await pc.getByTestId('desktop-icon-thispc').dblclick()
    await expect(pc.getByTestId('drive-S')).toContainText('Compta (\\\\SRV1) (S:)')

    // gpresult puis gpupdate : la stratégie d'ordinateur modifiée est appliquée
    await pc.getByTestId('start-button').click()
    await pc.getByTestId('start-app-powershell').click()
    const ps = pc.getByTestId('app-powershell')
    await ps.getByTestId('terminal-input').fill('gpresult /r')
    await ps.getByTestId('terminal-input').press('Enter')
    await expect(ps.getByTestId('terminal-powershell')).toContainText('GPO-Compta')
    await ps.getByTestId('terminal-input').fill('gpupdate /force')
    await ps.getByTestId('terminal-input').press('Enter')
    await expect(ps.getByTestId('terminal-powershell')).toContainText(
      'La mise à jour de la stratégie d’ordinateur s’est terminée sans erreur.'
    )

    // Déconnexion : le message légal précède désormais le formulaire d'ouverture de session
    await pc.getByTestId('start-button').click()
    await pc.getByTestId('start-user').click()
    await pc.getByTestId('logoff').click()
    await pc.getByTestId('send-cad').click()
    await expect(pc.getByTestId('logon-notice')).toContainText('Accès réservé au personnel autorisé.')
    await pc.getByTestId('logon-notice-ok').click()
    await expect(pc.getByTestId('logon-password')).toBeVisible()
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})

test('Éditeur GPO : un double-clic sur un paramètre non sélectionné ouvre sa fenêtre', async () => {
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await openLab(app, page, domainLab())
    await openTool(page, 'SRV1', 'gpmc')
    const srv = page.getByTestId('device-window-SRV1')
    await srv.getByTestId('maximize-device-window').click()
    const gpmc = srv.getByTestId('app-gpmc')
    await gpmc.getByTestId(`mmc-node-link|root|${DEFAULT_DOMAIN_POLICY_ID}`).click()
    await gpmc.getByTestId('gpmc-edit').click()
    const gpme = srv.getByTestId('app-gpme')
    await gpme.getByTestId('mmc-node-c-password').click()
    // Aucun paramètre sélectionné : le volet Actions ne doit pas décaler la table entre les deux clics
    await gpme.getByTestId('gpme-setting-passwordComplexity').dblclick()
    await expect(gpme.getByTestId('policy-dialog')).toBeVisible()
    await expect(gpme.getByTestId('policy-dialog')).toContainText('exigences de complexité')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
