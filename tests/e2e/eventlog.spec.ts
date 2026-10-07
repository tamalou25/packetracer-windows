import { expect, test } from '@playwright/test'
import { addDevice, createLab, logon, unwrap } from '../../src/engine/index'
import { openLab } from './fixtures'
import { launchApp, openTool } from './helpers'

test('Observateur d’événements : filtre du journal Sécurité par ID', async () => {
  const added = unwrap(addDevice(createLab(), { kind: 'server', position: { x: 200, y: 200 }, name: 'SRV1' }))
  let lab = added.state
  // Deux échecs puis une ouverture de session réussie : 4625, 4625, 4624, 4672
  for (const password of ['faux', 'faux', 'P@ssw0rd'])
    lab = logon(lab, added.value, { user: 'Administrateur', password, domain: null }).state
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await openLab(app, page, lab)
    const srv = page.getByTestId('device-window-SRV1')
    await openTool(page, 'SRV1', 'eventvwr')
    const viewer = srv.getByTestId('app-eventvwr')
    await viewer.getByTestId('mmc-node-log:Sécurité').click()
    await expect(viewer.getByTestId('eventvwr-count')).toContainText('Nombre d’événements : 4')
    await viewer.getByTestId('eventvwr-filter').click()
    const dialog = viewer.getByTestId('eventvwr-filter-dialog')
    await dialog.locator('input').nth(1).fill('4625')
    await dialog.getByRole('button', { name: 'OK' }).click()
    await expect(viewer.getByTestId('eventvwr-count')).toContainText('nombre d’événements : 2 sur 4')
    await viewer.getByTestId('eventvwr-unfilter').click()
    await expect(viewer.getByTestId('eventvwr-count')).toContainText('Nombre d’événements : 4')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
