import { expect, test, type Page } from '@playwright/test'
import { ACCOUNT_LOCKED, DEFAULT_DOMAIN_POLICY_ID } from '../../src/engine/index'
import { domainLab, openLab } from './fixtures'
import { expectSignedIn, launchApp, openTool, unlock } from './helpers'

/** Tentative d'ouverture de session sur l'écran affiché (formulaire déjà ouvert). */
async function attempt(page: Page, password: string): Promise<void> {
  const pc = page.getByTestId('device-window-PC1')
  await pc.getByTestId('logon-password').fill(password)
  await pc.getByTestId('logon-submit').click()
}

test('Verrouillage : seuil défini dans la GPO, compte verrouillé puis déverrouillé dans la console AD', async () => {
  const lab = domainLab()
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await openLab(app, page, lab)

    // Default Domain Policy : seuil de 3 tentatives, audit des échecs d'ouverture de session
    await openTool(page, 'SRV1', 'gpmc')
    const srv = page.getByTestId('device-window-SRV1')
    await srv.getByTestId('maximize-device-window').click()
    const gpmc = srv.getByTestId('app-gpmc')
    await gpmc.getByTestId(`mmc-node-link|root|${DEFAULT_DOMAIN_POLICY_ID}`).click()
    await gpmc.getByTestId('gpmc-edit').click()
    const gpme = srv.getByTestId('app-gpme')
    await gpme.getByTestId('mmc-node-c-lockout').click()
    await gpme.getByTestId('gpme-setting-lockoutThreshold').click()
    await gpme.getByTestId('gpme-edit').click()
    await gpme.getByTestId('policy-define').check()
    await gpme.getByTestId('policy-number').fill('3')
    await gpme.getByTestId('policy-ok').click()
    await expect(gpme.getByTestId('gpme-state-lockoutThreshold')).toContainText('3 tentative(s)')
    await gpme.getByTestId('mmc-node-c-auditpol').click()
    await gpme.getByTestId('gpme-setting-auditLogon').click()
    await gpme.getByTestId('gpme-edit').click()
    await gpme.getByTestId('policy-define').check()
    await gpme.getByTestId('policy-audit-failure').check()
    await gpme.getByTestId('policy-ok').click()
    await expect(gpme.getByTestId('gpme-state-auditLogon')).toHaveText('Échec')
    await gpme.getByTestId('window-close').click()
    await gpmc.getByTestId('window-close').click()
    await srv.getByTestId('close-device-window').click()

    // Poste : trois mauvais mots de passe, puis le bon mot de passe est refusé
    await page.getByTestId('device-PC1').dblclick()
    const pc = page.getByTestId('device-window-PC1')
    await pc.getByTestId('tab-desktop').click()
    await pc.getByTestId('send-cad').click()
    await pc.getByTestId('logon-user').fill('jdupont')
    for (let i = 0; i < 3; i++) {
      await attempt(page, 'faux')
      await expect(pc.getByTestId('logon-error')).toBeVisible()
      await pc.getByTestId('logon-error-ok').click()
    }
    await attempt(page, 'Azerty123!')
    await expect(pc.getByTestId('logon-error')).toHaveText(ACCOUNT_LOCKED)
    await pc.getByTestId('logon-error-ok').click()
    await pc.getByTestId('close-device-window').click()

    // Console AD : le compte apparaît verrouillé, l'administrateur le déverrouille
    await openTool(page, 'SRV1', 'aduc')
    const aduc = srv.getByTestId('app-aduc')
    await aduc.getByTestId('aduc-obj-Compta').dblclick()
    await aduc.getByTestId('aduc-obj-Jean Dupont').click()
    await expect(aduc.getByTestId('aduc-locked')).toBeVisible()
    await aduc.getByTestId('aduc-unlock').click()
    await expect(aduc.getByTestId('aduc-locked')).toHaveCount(0)
    await srv.getByTestId('close-device-window').click()

    // Le compte déverrouillé ouvre de nouveau sa session
    await page.getByTestId('device-PC1').dblclick()
    await pc.getByTestId('tab-desktop').click()
    await unlock(page, 'PC1', 'Azerty123!', 'jdupont')
    await expectSignedIn(page, 'PC1')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
