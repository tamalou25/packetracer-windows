import { expect, test } from '@playwright/test'
import { installFeatures, unwrap } from '../../src/engine/index'
import { domainLab, openLab } from './fixtures'
import { launchApp, openTool } from './helpers'

test('AD CS : AC configurée dans la console, certificat de domaine depuis IIS, révocation', async () => {
  let lab = domainLab()
  const srvId = Object.values(lab.devices).find((d) => d.name === 'SRV1')!.id
  lab = unwrap(
    installFeatures(lab, srvId, ['ADCS-Cert-Authority', 'Web-Server'], { includeManagementTools: true })
  ).state
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await openLab(app, page, lab)
    const srv = page.getByTestId('device-window-SRV1')

    // Configuration de l'autorité racine d'entreprise
    await openTool(page, 'SRV1', 'certsrv')
    await expect(srv.getByTestId('ca-name')).toHaveValue('LAB-SRV1-CA')
    await srv.getByTestId('ca-configure').getByRole('button', { name: 'Configurer' }).click()
    await expect(srv.getByTestId('ca-console')).toContainText('LAB-SRV1-CA')
    await srv.getByTestId('mmc-node-templates').click()
    await expect(srv.getByTestId('ca-templates')).toContainText('Serveur Web')

    // Gestionnaire IIS : certificat de domaine
    await srv.getByTestId('start-button').click({ button: 'right' })
    await srv.getByTestId('winx-run').click()
    await srv.getByTestId('run-input').fill('inetmgr')
    await srv.getByTestId('run-ok').click()
    const iis = srv.getByTestId('app-inetmgr')
    await iis.getByTestId('mmc-node-certs').click()
    await iis.getByTestId('iis-domain-cert').click()
    await iis.getByTestId('iis-domain-cert-dialog').locator('input').first().fill('intranet.lab.local')
    await iis.getByTestId('iis-domain-cert-dialog').getByRole('button', { name: 'OK' }).click()
    await expect(iis.getByTestId('iis-certs')).toContainText('LAB-SRV1-CA')

    // Console de l'AC : certificat délivré, puis révoqué
    const ca = srv.getByTestId('app-certsrv')
    await ca.click({ position: { x: 5, y: 5 } })
    await ca.getByTestId('mmc-node-issued').click()
    await expect(ca.getByTestId('ca-issued')).toContainText('intranet.lab.local')
    await ca.locator('[data-testid^="ca-revoke-"]').first().click()
    await ca.getByTestId('mmc-node-revoked').click()
    await expect(ca.getByTestId('ca-revoked')).toContainText('intranet.lab.local')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
