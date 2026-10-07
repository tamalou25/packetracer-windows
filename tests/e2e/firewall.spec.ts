import { expect, test } from '@playwright/test'
import { buildLabStart, parseLab } from '../../src/engine/index'
import firewallLab from '../../labs/lab-15-pare-feu.json'
import { openLab } from './fixtures'
import { launchApp, openConsole, openTool, typeCommand } from './helpers'

test('Pare-feu : règle de blocage ICMP créée dans wf.msc, ping du poste en échec', async () => {
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    const parsed = parseLab(firewallLab)
    if (!parsed.ok) throw new Error(parsed.message)
    await openLab(app, page, buildLabStart(parsed.lab.start))
    // Avant : le serveur répond au ping
    await openConsole(page, 'PC1', 'cmd')
    await typeCommand(page, 'PC1', 'ping -n 1 192.168.10.1')
    const pc = page.getByTestId('device-window-PC1').getByTestId('terminal-cmd')
    await expect(pc).toContainText('Réponse de 192.168.10.1')
    await page.getByTestId('device-window-PC1').getByTestId('close-device-window').click()

    const srv = page.getByTestId('device-window-SRV1')
    await openTool(page, 'SRV1', 'wf')
    const wf = srv.getByTestId('app-wf')
    await expect(wf.getByTestId('wf-profile-Public')).toContainText('Profil public est actif')
    await wf.getByTestId('mmc-node-inbound').click()
    await wf.getByTestId('wf-new-rule').click()
    const dialog = wf.getByTestId('wf-dialog')
    await dialog.locator('input').first().fill('Bloquer le ping')
    await dialog.locator('select').nth(0).selectOption('Block')
    await dialog.locator('select').nth(1).selectOption('ICMPv4')
    await dialog.getByRole('button', { name: 'OK' }).click()
    await expect(wf.getByTestId('wf-rules')).toContainText('Bloquer le ping')
    await srv.getByTestId('close-device-window').click()

    await openConsole(page, 'PC1', 'cmd')
    await typeCommand(page, 'PC1', 'ping -n 1 192.168.10.1')
    await expect(page.getByTestId('device-window-PC1').getByTestId('terminal-cmd')).toContainText(
      'Délai d’attente de la demande dépassé.'
    )
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
