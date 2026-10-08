import { expect, test, type Page } from '@playwright/test'
import { domainLab, openLab } from './fixtures'
import { expectSignedIn, launchApp, openTool } from './helpers'

/** Tentative d'ouverture de session sur l'écran affiché (formulaire déjà ouvert). */
async function attempt(page: Page, password: string): Promise<void> {
  const pc = page.getByTestId('device-window-PC1')
  await pc.getByTestId('logon-password').fill(password)
  await pc.getByTestId('logon-submit').click()
}

test('Détection : trois échecs puis un succès lèvent une alerte, l’affichage personnalisé isole les échecs', async () => {
  const lab = domainLab()
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await openLab(app, page, lab)

    // Onglet Audit : aucune alerte au départ
    await page.getByTestId('right-tab-audit').click()
    await expect(page.getByTestId('detection-panel')).toBeVisible()
    await expect(page.getByTestId('detection-failuresThenSuccess')).toHaveCount(0)

    // Poste : trois mauvais mots de passe puis le bon
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
    await expectSignedIn(page, 'PC1')
    await pc.getByTestId('close-device-window').click()

    await expect(page.getByTestId('detection-failuresThenSuccess')).toContainText('LAB\\jdupont')

    // Contrôleur : l'affichage personnalisé « Échecs d'ouverture de session » ne montre que les 4771
    await openTool(page, 'SRV1', 'eventvwr')
    const viewer = page.getByTestId('device-window-SRV1').getByTestId('app-eventvwr')
    await viewer.getByTestId('mmc-node-view:logonFailures').click()
    await expect(viewer.getByTestId('eventvwr-count')).toContainText('nombre d’événements : 3 sur')
    await expect(viewer.getByTestId('eventvwr-events')).not.toContainText('4624')
    await viewer.getByTestId('mmc-node-view:kerberos').click()
    await expect(viewer.getByTestId('eventvwr-events')).toContainText('4769')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
