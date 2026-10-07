import { expect, test } from '@playwright/test'
import { buildLabStart, parseLab } from '../../src/engine/index'
import adLab from '../../labs/lab-19-durcissement-ad.json'
import { openLab } from './fixtures'
import { launchApp, openTool } from './helpers'

test('Durcissement AD : décocher « n’expire jamais » retire la recommandation de l’audit', async () => {
  const parsed = parseLab(adLab)
  if (!parsed.ok) throw new Error(parsed.message)
  const lab = buildLabStart(parsed.lab.start)
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await openLab(app, page, lab)
    await page.getByTestId('right-tab-audit').click()
    const audit = page.getByTestId('audit-panel')
    await expect(audit.getByTestId('audit-passwordNeverExpires')).toContainText('LAB\\svc-sauvegarde')
    const srv = page.getByTestId('device-window-SRV1')
    await openTool(page, 'SRV1', 'aduc')
    const aduc = srv.getByTestId('app-aduc')
    await aduc
      .getByTestId(/^mmc-node-/)
      .filter({ hasText: /^Users$/ })
      .click()
    await aduc.getByTestId('aduc-obj-Service sauvegarde').click()
    await aduc.getByTestId('aduc-never-expires').uncheck()
    await expect(audit.getByTestId('audit-passwordNeverExpires')).toHaveCount(0)
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
