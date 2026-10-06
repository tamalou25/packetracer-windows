import { expect, test, type Locator } from '@playwright/test'
import { cableDevices, configureHostIp, launchApp, openDesktop, placeDevice } from './helpers'

/** Commande de la boîte Exécuter (clic droit sur Démarrer). */
async function runBox(win: Locator, command: string): Promise<void> {
  await win.getByTestId('start-button').click({ button: 'right' })
  await win.getByTestId('winx-run').click()
  await win.getByTestId('run-input').fill(command)
  await win.getByTestId('run-ok').click()
}

/** Connexion Bureau à distance vers SRV1 avec l'Administrateur local ; renvoie la fenêtre mstsc. */
async function connect(win: Locator): Promise<Locator> {
  const mstsc = win.getByTestId('app-mstsc')
  if (!(await mstsc.isVisible())) await runBox(win, 'mstsc')
  await mstsc.getByTestId('mstsc-computer').fill('192.168.10.1')
  await mstsc.getByTestId('mstsc-user').fill('SRV1\\Administrateur')
  await mstsc.getByTestId('mstsc-password').fill('P@ssw0rd')
  await mstsc.getByTestId('mstsc-connect').click()
  return mstsc
}

test('Bureau à distance : refus tant que les connexions sont interdites, puis session ouverte', async () => {
  const { close, page, consoleErrors } = await launchApp()
  try {
    await placeDevice(page, 'server', 220, 160)
    await placeDevice(page, 'client', 220, 420)
    await placeDevice(page, 'switch', 520, 290)
    await cableDevices(page, 'SRV1', 'Ethernet0', 'SW1', 'Fa0/1')
    await cableDevices(page, 'PC1', 'Ethernet0', 'SW1', 'Fa0/2')
    await configureHostIp(page, 'SRV1', '192.168.10.1', '255.255.255.0')
    await configureHostIp(page, 'PC1', '192.168.10.10', '255.255.255.0')

    // Connexion refusée : Bureau à distance non autorisé sur SRV1
    const mstsc = await connect(await openDesktop(page, 'PC1'))
    await expect(mstsc.getByTestId('mstsc-result')).toContainText(
      'L’accès à distance au serveur n’est pas activé'
    )
    await page.getByTestId('device-window-PC1').getByTestId('close-device-window').click()

    // Propriétés système de SRV1 > Utilisation à distance : autoriser les connexions
    const srv = await openDesktop(page, 'SRV1')
    await runBox(srv, 'sysdm.cpl')
    await srv.getByRole('tab', { name: 'Utilisation à distance' }).click()
    await srv.getByTestId('rdp-allow').check()
    await page.getByTestId('device-window-SRV1').getByTestId('close-device-window').click()

    const again = await connect(await openDesktop(page, 'PC1'))
    await expect(again.getByTestId('mstsc-result')).toContainText('Session ouverte sur 192.168.10.1')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
