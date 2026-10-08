import { expect, test, type Page } from '@playwright/test'
import {
  addDevice,
  connect,
  createLab,
  setInterfaceIpv4,
  unwrap,
  type DeviceKind,
  type IosModel,
  type LabState
} from '../../src/engine/index'
import { openLab } from './fixtures'
import { launchApp, openConsole, typeCommand } from './helpers'

/** PC1 (VLAN 10) et PC2 (VLAN 20) sur SW1 (2960) ; R1 (1921) Gi0/0 sur l'uplink Gi0/1. */
function ciscoLab(): LabState {
  let s = createLab()
  const ids: Record<string, string> = {}
  const add = (kind: DeviceKind, name: string, x: number, y: number, model?: IosModel) => {
    const r = unwrap(addDevice(s, { kind, position: { x, y }, name, ...(model ? { model } : {}) }))
    s = r.state
    ids[name] = r.value
  }
  add('client', 'PC1', 100, 300)
  add('client', 'PC2', 500, 300)
  add('switch', 'SW1', 300, 200, 'c2960')
  add('router', 'R1', 300, 40, 'c1921')
  const port = (name: string, i: number) => s.devices[ids[name]!]!.interfaces[i]!.id
  const cable = (a: string, ia: number, b: string, ib: number) => {
    s = unwrap(
      connect(s, { deviceId: ids[a]!, ifaceId: port(a, ia) }, { deviceId: ids[b]!, ifaceId: port(b, ib) })
    ).state
  }
  cable('PC1', 0, 'SW1', 0)
  cable('PC2', 0, 'SW1', 1)
  cable('R1', 0, 'SW1', 24)
  const ip = (name: string, address: string, gateway: string) => {
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
  ip('PC1', '192.168.10.10', '192.168.10.1')
  ip('PC2', '192.168.20.10', '192.168.20.1')
  return s
}

async function cli(page: Page, device: string, lines: string[]): Promise<void> {
  const win = page.getByTestId(`device-window-${device}`)
  if ((await win.count()) === 0) await page.getByTestId(`device-${device}`).dblclick()
  for (const line of lines) await typeCommand(page, device, line)
}

test('IOS : VLAN et trunk en CLI, router-on-a-stick, ping inter-VLAN', async () => {
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await openLab(app, page, ciscoLab())
    await cli(page, 'SW1', [
      'en',
      'conf t',
      'vlan 10',
      'vlan 20',
      'exit',
      'int fa0/1',
      'switchport mode access',
      'switchport access vlan 10',
      'int fa0/2',
      'switchport mode access',
      'switchport access vlan 20',
      'int g0/1',
      'switchport mode trunk',
      'end',
      'show vlan brief'
    ])
    const swTerm = page.getByTestId('device-window-SW1').getByTestId('terminal-ios')
    await expect(swTerm).toContainText(/10\s+VLAN0010\s+active\s+Fa0\/1/)
    await page.getByTestId('device-window-SW1').getByTestId('close-device-window').click()

    await cli(page, 'R1', [
      'en',
      'conf t',
      'int g0/0',
      'no shutdown',
      'int g0/0.10',
      'encapsulation dot1Q 10',
      'ip address 192.168.10.1 255.255.255.0',
      'int g0/0.20',
      'encapsulation dot1Q 20',
      'ip address 192.168.20.1 255.255.255.0',
      'end'
    ])
    await expect(page.getByTestId('device-window-R1').getByTestId('terminal-ios')).toContainText('R1#')
    await page.getByTestId('device-window-R1').getByTestId('close-device-window').click()

    await openConsole(page, 'PC1', 'cmd')
    await typeCommand(page, 'PC1', 'ping 192.168.20.10')
    await expect(page.getByTestId('device-window-PC1').getByTestId('terminal-cmd')).toContainText(
      'Réponse de 192.168.20.10'
    )
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
