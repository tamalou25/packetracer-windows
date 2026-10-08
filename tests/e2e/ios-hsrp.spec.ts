import { expect, test, type Page } from '@playwright/test'
import {
  addDevice,
  connect,
  createLab,
  setInterfaceEnabled,
  setInterfaceIpv4,
  unwrap,
  type DeviceKind,
  type IosModel,
  type LabState
} from '../../src/engine/index'
import { openLab } from './fixtures'
import { launchApp, openConsole, typeCommand } from './helpers'

/** R1, R2 (1921) et PC1 sur SW1 (2960) ; routeurs adressés, HSRP à configurer en CLI. */
function hsrpLab(): LabState {
  let s = createLab()
  const ids: Record<string, string> = {}
  const add = (kind: DeviceKind, name: string, x: number, y: number, model?: IosModel) => {
    const r = unwrap(addDevice(s, { kind, position: { x, y }, name, ...(model ? { model } : {}) }))
    s = r.state
    ids[name] = r.value
  }
  add('router', 'R1', 150, 60, 'c1921')
  add('router', 'R2', 450, 60, 'c1921')
  add('switch', 'SW1', 300, 220, 'c2960')
  add('client', 'PC1', 300, 400)
  const port = (name: string, i: number) => s.devices[ids[name]!]!.interfaces[i]!.id
  const cable = (a: string, ia: number, b: string, ib: number) => {
    s = unwrap(
      connect(s, { deviceId: ids[a]!, ifaceId: port(a, ia) }, { deviceId: ids[b]!, ifaceId: port(b, ib) })
    ).state
  }
  cable('R1', 0, 'SW1', 0)
  cable('R2', 0, 'SW1', 1)
  cable('PC1', 0, 'SW1', 2)
  const ip = (name: string, address: string, gateway: string | null) => {
    s = unwrap(
      setInterfaceIpv4(s, ids[name]!, port(name, 0), {
        addressing: 'static',
        address,
        mask: '24',
        gateway,
        dnsServers: []
      })
    ).state
  }
  ip('R1', '192.168.1.1', null)
  ip('R2', '192.168.1.2', null)
  ip('PC1', '192.168.1.10', '192.168.1.254')
  s = unwrap(setInterfaceEnabled(s, ids.R1!, port('R1', 0), true)).state
  s = unwrap(setInterfaceEnabled(s, ids.R2!, port('R2', 0), true)).state
  return s
}

async function cli(page: Page, device: string, lines: string[]): Promise<void> {
  if ((await page.getByTestId(`device-window-${device}`).count()) === 0)
    await page.getByTestId(`device-${device}`).dblclick()
  for (const line of lines) await typeCommand(page, device, line)
}

test('IOS : HSRP, passerelle virtuelle puis bascule quand le routeur actif s’éteint', async () => {
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await openLab(app, page, hsrpLab())
    await cli(page, 'R2', ['en', 'conf t', 'int g0/0', 'standby 1 ip 192.168.1.254', 'end'])
    await page.getByTestId('device-window-R2').getByTestId('close-device-window').click()
    await cli(page, 'R1', [
      'en',
      'conf t',
      'int g0/0',
      'standby 1 ip 192.168.1.254',
      'standby 1 priority 110',
      'standby 1 preempt',
      'end',
      'show standby brief'
    ])
    const r1 = page.getByTestId('device-window-R1').getByTestId('terminal-ios')
    await expect(r1).toContainText('%HSRP-6-STATECHANGE: GigabitEthernet0/0 Grp 1 state Standby -> Active')
    await expect(r1).toContainText(/Gi0\/0\s+1\s+110 P Active\s+local\s+192\.168\.1\.2\s+192\.168\.1\.254/)
    await page.getByTestId('device-window-R1').getByTestId('close-device-window').click()

    // R1 éteint : R2 devient actif, la passerelle virtuelle répond toujours
    await page.getByTestId('device-R1').click()
    await page.getByTestId('power-toggle').click()
    await cli(page, 'R2', ['show standby brief'])
    await expect(page.getByTestId('device-window-R2').getByTestId('terminal-ios')).toContainText(
      /Gi0\/0\s+1\s+100\s+Active\s+local/
    )
    await page.getByTestId('device-window-R2').getByTestId('close-device-window').click()
    await openConsole(page, 'PC1', 'cmd')
    await typeCommand(page, 'PC1', 'ping 192.168.1.254')
    await expect(page.getByTestId('device-window-PC1').getByTestId('terminal-cmd')).toContainText(
      'Réponse de 192.168.1.254'
    )
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
