import { expect, test } from '@playwright/test'
import { addScope, buildLabStart, parseLab, setDhcpOptions, unwrap } from '../../src/engine/index'
import relayLab from '../../labs/lab-14-relais-dhcp.json'
import { openLab } from './fixtures'
import { launchApp, openConsole, typeCommand } from './helpers'

test('Relais DHCP : adresse de relais saisie sur l’interface du routeur, bail obtenu par PC2', async () => {
  const parsed = parseLab(relayLab)
  if (!parsed.ok) throw new Error(parsed.message)
  let lab = buildLabStart(parsed.lab.start)
  const srv = Object.values(lab.devices).find((d) => d.name === 'SRV1')!.id
  const scope = unwrap(
    addScope(lab, srv, {
      name: 'LAN2',
      start: '192.168.20.100',
      end: '192.168.20.200',
      mask: '255.255.255.0'
    })
  )
  lab = unwrap(setDhcpOptions(scope.state, srv, scope.value, { router: ['192.168.20.254'] })).state
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await openLab(app, page, lab)
    await page.getByTestId('device-R1').dblclick()
    const r1 = page.getByTestId('device-window-R1')
    await r1.getByTestId('nav-iface-Gi0/1').click()
    await r1.getByTestId('if-helper').fill('192.168.10.1')
    await r1.getByTestId('if-helper-apply').click()
    await r1.getByTestId('close-device-window').click()

    await openConsole(page, 'PC2', 'cmd')
    await typeCommand(page, 'PC2', 'ipconfig /renew')
    await expect(page.getByTestId('device-window-PC2').getByTestId('terminal-cmd')).toContainText(
      '192.168.20.100'
    )
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
