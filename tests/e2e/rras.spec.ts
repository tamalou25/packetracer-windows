import { expect, test } from '@playwright/test'
import { buildLabStart, installFeatures, parseLab, unwrap } from '../../src/engine/index'
import accessLab from '../../labs/lab-16-acces-distant.json'
import { openLab } from './fixtures'
import { launchApp, openDesktop, openTool } from './helpers'

test('Accès à distance : assistant VPN et NAT, connexion VPN depuis le poste distant', async () => {
  const parsed = parseLab(accessLab)
  if (!parsed.ok) throw new Error(parsed.message)
  let lab = buildLabStart(parsed.lab.start)
  const srvId = Object.values(lab.devices).find((d) => d.name === 'SRV1')!.id
  lab = unwrap(
    installFeatures(lab, srvId, ['RemoteAccess', 'DirectAccess-VPN', 'Routing'], {
      includeManagementTools: true
    })
  ).state
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await openLab(app, page, lab)
    const srv = page.getByTestId('device-window-SRV1')
    await openTool(page, 'SRV1', 'rrasmgmt')
    const rras = srv.getByTestId('app-rrasmgmt')
    await rras.getByTestId('rras-configure').click()
    const dialog = rras.getByTestId('rras-dialog')
    await dialog.locator('select').nth(0).selectOption('vpn-nat')
    await dialog.locator('select').nth(1).selectOption({ label: 'Ethernet1 (203.0.113.2)' })
    await dialog.locator('input').nth(0).fill('192.168.10.200')
    await dialog.locator('input').nth(1).fill('192.168.10.220')
    await dialog.getByRole('button', { name: 'OK' }).click()
    await expect(rras.getByTestId('rras-status')).toContainText('Accès VPN et NAT')
    await srv.getByTestId('close-device-window').click()

    // Poste distant : Paramètres > Réseau > VPN
    const pcr = await openDesktop(page, 'PCR')
    await pcr.getByTestId('start-button').click({ button: 'right' })
    await pcr.getByTestId('winx-run').click()
    await pcr.getByTestId('run-input').fill('ms-settings:network-vpn')
    await pcr.getByTestId('run-ok').click()
    const vpn = pcr.getByTestId('vpn-settings')
    await vpn.getByTestId('vpn-add').click()
    const add = pcr.getByTestId('vpn-dialog')
    await add.locator('input').nth(0).fill('Entreprise')
    await add.locator('input').nth(1).fill('203.0.113.2')
    await add.getByRole('button', { name: 'OK' }).click()
    await vpn.getByTestId('vpn-connect').click()
    const login = pcr.getByTestId('vpn-dialog')
    await login.locator('input').nth(0).fill('LAB\\jdupont')
    await login.locator('input').nth(1).fill('Azerty123!')
    await login.getByRole('button', { name: 'OK' }).click()
    await expect(vpn.getByTestId('vpn-Entreprise')).toContainText('Connecté — adresse 192.168.10.200')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
