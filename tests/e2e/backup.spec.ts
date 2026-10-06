import { expect, test } from '@playwright/test'
import {
  createItem,
  domainToken,
  enableRecycleBin,
  installFeatures,
  removeObject,
  unwrap
} from '../../src/engine/index'
import { domainLab, openLab } from './fixtures'
import { launchApp, openTool } from './helpers'

test('Sauvegarde Windows Server : planification puis sauvegarde unique dans la console', async () => {
  let lab = domainLab()
  const srvId = Object.values(lab.devices).find((d) => d.name === 'SRV1')!.id
  lab = unwrap(installFeatures(lab, srvId, ['Windows-Server-Backup'])).state
  const admin = domainToken(lab.domains['lab.local']!, 'Administrateur')!
  lab = unwrap(createItem(lab, srvId, 'C:\\Compta', 'folder', admin)).state
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await openLab(app, page, lab)
    const srv = page.getByTestId('device-window-SRV1')
    await openTool(page, 'SRV1', 'wbadmin')
    const wb = srv.getByTestId('app-wbadmin')
    await wb.getByTestId('wb-schedule').click()
    const inputs = wb.getByTestId('wb-dialog').locator('input:not([type=checkbox])')
    await inputs.nth(0).fill('C:\\Compta')
    await inputs.nth(2).fill('E:')
    await wb.getByTestId('wb-dialog').getByRole('button', { name: 'OK' }).click()
    await expect(wb.getByTestId('wb-policy')).toContainText('Tous les jours à 21:00 vers E:')

    await wb.getByTestId('wb-once').click()
    await wb.getByTestId('wb-dialog').getByRole('button', { name: 'OK' }).click()
    await expect(wb.getByTestId('wb-versions')).toContainText('C:\\Compta')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})

test('Centre d’administration Active Directory : restauration depuis la Corbeille', async () => {
  let lab = domainLab()
  lab = unwrap(enableRecycleBin(lab, 'lab.local')).state
  const jd = lab.domains['lab.local']!.users.find((u) => u.sam === 'jdupont')!
  lab = unwrap(removeObject(lab, 'lab.local', jd.id)).state
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await openLab(app, page, lab)
    const srv = page.getByTestId('device-window-SRV1')
    await openTool(page, 'SRV1', 'dsac')
    const adac = srv.getByTestId('app-dsac')
    await expect(adac.getByTestId('adac-overview')).toContainText('Corbeille : activée')
    await adac.getByTestId('mmc-node-deleted').click()
    await adac.getByTestId('adac-restore-Jean Dupont').click()
    await expect(adac.getByTestId('adac-deleted')).toContainText('Aucun objet supprimé.')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
