import { expect, test } from '@playwright/test'
import {
  addDevice,
  addSubinterface,
  connect,
  createLab,
  setInterfaceIpv4,
  setSwitchport,
  unwrap,
  type DeviceKind,
  type LabState
} from '../../src/engine/index'
import { openLab } from './fixtures'
import { launchApp, openConsole, typeCommand } from './helpers'

/** PC1 (VLAN à configurer) et PC2 (VLAN 20, prêt) sur SW1 ; R1 sur Fa0/16, Gi0/0.20 prêt. */
function vlanLab(): LabState {
  let s = createLab()
  const ids: Record<string, string> = {}
  const add = (kind: DeviceKind, name: string, x: number, y: number) => {
    const r = unwrap(addDevice(s, { kind, position: { x, y }, name }))
    s = r.state
    ids[name] = r.value
  }
  add('client', 'PC1', 100, 300)
  add('client', 'PC2', 500, 300)
  add('switch', 'SW1', 300, 200)
  add('router', 'R1', 300, 40)
  const port = (name: string, i: number) => s.devices[ids[name]!]!.interfaces[i]!.id
  const cable = (a: string, ia: number, b: string, ib: number) => {
    s = unwrap(
      connect(s, { deviceId: ids[a]!, ifaceId: port(a, ia) }, { deviceId: ids[b]!, ifaceId: port(b, ib) })
    ).state
  }
  cable('PC1', 0, 'SW1', 0)
  cable('PC2', 0, 'SW1', 1)
  cable('R1', 0, 'SW1', 15)
  const ip = (name: string, ifaceId: string, address: string, gateway: string | null) => {
    s = unwrap(
      setInterfaceIpv4(s, ids[name]!, ifaceId, {
        addressing: 'static',
        address,
        mask: '24',
        gateway,
        dnsServers: []
      })
    ).state
  }
  ip('PC1', port('PC1', 0), '192.168.10.10', '192.168.10.254')
  ip('PC2', port('PC2', 0), '192.168.20.10', '192.168.20.254')
  s = unwrap(setSwitchport(s, ids.SW1!, port('SW1', 1), { mode: 'access', accessVlan: 20 })).state
  const sub = unwrap(addSubinterface(s, ids.R1!, port('R1', 0), 20))
  s = sub.state
  ip('R1', sub.value, '192.168.20.254', null)
  return s
}

test('VLAN : base, ports d’accès et trunk, sous-interface, puis ping inter-VLAN', async () => {
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await openLab(app, page, vlanLab())

    // Switch : VLAN 10, Fa0/1 en accès VLAN 10, Fa0/16 en trunk
    await page.getByTestId('device-SW1').dblclick()
    const sw = page.getByTestId('device-window-SW1')
    await sw.getByTestId('nav-vlans').click()
    await sw.getByTestId('vlan-new-id').fill('10')
    await sw.getByTestId('vlan-new-name').fill('Compta')
    await sw.getByTestId('vlan-add').click()
    await expect(sw.getByTestId('vlan-db')).toContainText('Compta')
    await sw.getByTestId('vlan-port-Fa0/1').getByTestId('vlan-access').selectOption('10')
    await sw.getByTestId('vlan-port-Fa0/16').getByTestId('vlan-mode').selectOption('trunk')
    await expect(sw.getByTestId('vlan-db')).toContainText('Fa0/1')
    await sw.getByTestId('close-device-window').click()

    // Routeur : sous-interface Gi0/0.10, passerelle du VLAN 10
    await page.getByTestId('device-R1').dblclick()
    const r1 = page.getByTestId('device-window-R1')
    await r1.getByTestId('nav-subifs').click()
    await r1.getByTestId('subif-vlan').fill('10')
    await r1.getByTestId('subif-add').click()
    await expect(r1.getByTestId('subif-list')).toContainText('Gi0/0.10')
    await r1.getByTestId('nav-iface-Gi0/0.10').click()
    await r1.getByTestId('if-address').fill('192.168.10.254')
    await r1.getByTestId('if-mask').fill('255.255.255.0')
    await r1.getByTestId('if-apply').click()
    await r1.getByTestId('close-device-window').click()

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
