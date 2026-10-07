import { expect, test } from '@playwright/test'
import { buildLabStart, command, dispatch, installFeatures, parseLab, unwrap } from '../../src/engine/index'
import npsLab from '../../labs/lab-17-nps-radius.json'
import { openLab } from './fixtures'
import { launchApp, openDesktop, openTool } from './helpers'

test('NPS : client RADIUS et stratégie réseau, authentification RADIUS du VPN', async () => {
  const parsed = parseLab(npsLab)
  if (!parsed.ok) throw new Error(parsed.message)
  let lab = buildLabStart(parsed.lab.start)
  const idOf = (name: string) => Object.values(lab.devices).find((d) => d.name === name)!.id
  lab = unwrap(installFeatures(lab, idOf('SRV1'), ['NPAS'], { includeManagementTools: true })).state
  const wan = lab.devices[idOf('SRV2')]!.interfaces.find((i) => i.name === 'Ethernet1')!.id
  const configured = dispatch(
    lab,
    command('rras.configure', idOf('SRV2'), {
      mode: 'vpn',
      publicIfaceId: wan,
      pool: { start: '192.168.10.200', end: '192.168.10.220' }
    })
  )
  if (!configured.ok) throw new Error(configured.error.message)
  lab = configured.state
  const added = dispatch(
    lab,
    command('vpn.addConnection', idOf('PCR'), { name: 'Entreprise', server: '203.0.113.2' })
  )
  if (!added.ok) throw new Error(added.error.message)
  lab = added.state

  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await openLab(app, page, lab)
    // SRV1 : client RADIUS et stratégie réseau dans nps.msc
    const srv1 = page.getByTestId('device-window-SRV1')
    await openTool(page, 'SRV1', 'nps')
    const nps = srv1.getByTestId('app-nps')
    await nps.getByTestId('mmc-node-clients').click()
    await nps.getByTestId('nps-new-client').click()
    const client = nps.getByTestId('nps-dialog')
    await client.locator('input').nth(0).fill('SRV2-VPN')
    await client.locator('input').nth(1).fill('192.168.10.2')
    await client.locator('input').nth(2).fill('R@dius2026')
    await client.getByRole('button', { name: 'OK' }).click()
    await expect(nps.getByTestId('nps-clients')).toContainText('192.168.10.2')
    await nps.getByTestId('mmc-node-network').click()
    await nps.getByTestId('nps-new-policy').click()
    const policy = nps.getByTestId('nps-dialog')
    await policy.locator('input').nth(0).fill('Accès VPN')
    await policy.locator('select').nth(0).selectOption('LAB\\GG_VPN')
    await policy.getByRole('button', { name: 'OK' }).click()
    const rows = nps.getByTestId('nps-policies').locator('tbody tr')
    await expect(rows.first()).toContainText('Accès VPN')
    await expect(rows.first()).toContainText('Groupes Windows : LAB\\GG_VPN')
    await srv1.getByTestId('close-device-window').click()

    // SRV2 : authentification RADIUS dans rrasmgmt.msc
    const srv2 = page.getByTestId('device-window-SRV2')
    await openTool(page, 'SRV2', 'rrasmgmt')
    const rras = srv2.getByTestId('app-rrasmgmt')
    await rras.getByTestId('rras-auth').click()
    const auth = rras.getByTestId('rras-dialog')
    await auth.locator('select').nth(0).selectOption('radius')
    await auth.locator('input').nth(0).fill('192.168.10.1')
    await auth.locator('input').nth(1).fill('R@dius2026')
    await auth.getByRole('button', { name: 'OK' }).click()
    await expect(rras.getByTestId('rras-auth-provider')).toContainText(
      'Authentification RADIUS (192.168.10.1)'
    )
    await srv2.getByTestId('close-device-window').click()

    // PCR : seul le membre de GG_VPN se connecte
    const pcr = await openDesktop(page, 'PCR')
    await pcr.getByTestId('start-button').click({ button: 'right' })
    await pcr.getByTestId('winx-run').click()
    await pcr.getByTestId('run-input').fill('ms-settings:network-vpn')
    await pcr.getByTestId('run-ok').click()
    const vpn = pcr.getByTestId('vpn-settings')
    const connectAs = async (user: string) => {
      await vpn.getByTestId('vpn-connect').click()
      const login = pcr.getByTestId('vpn-dialog')
      await login.locator('input').nth(0).fill(user)
      await login.locator('input').nth(1).fill('Azerty123!')
      await login.getByRole('button', { name: 'OK' }).click()
    }
    await connectAs('LAB\\mmartin')
    await expect(page.getByText(/Erreur 691/).first()).toBeVisible()
    await pcr.getByTestId('vpn-dialog').getByRole('button', { name: 'Annuler' }).click()
    await connectAs('LAB\\jdupont')
    await expect(vpn.getByTestId('vpn-Entreprise')).toContainText('Connecté — adresse 192.168.10.200')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
