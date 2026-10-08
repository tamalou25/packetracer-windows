import { expect, test, type Page } from '@playwright/test'
import {
  addDevice,
  connect,
  createLab,
  setInterfaceEnabled,
  setInterfaceIpv4,
  unwrap,
  type LabState
} from '../../src/engine/index'
import { openLab } from './fixtures'
import { launchApp, typeCommand } from './helpers'

/** Triangle R1–R2–R3 (1921) adressé, interfaces actives ; OSPF à configurer en CLI. */
function triangleLab(): LabState {
  let s = createLab()
  const ids: Record<string, string> = {}
  for (const [name, x, y] of [
    ['R1', 100, 100],
    ['R2', 400, 100],
    ['R3', 250, 300]
  ] as const) {
    const r = unwrap(addDevice(s, { kind: 'router', model: 'c1921', name, position: { x, y } }))
    s = r.state
    ids[name] = r.value
  }
  const port = (name: string, i: number) => s.devices[ids[name]!]!.interfaces[i]!.id
  const link = (a: string, ia: number, b: string, ib: number) => {
    s = unwrap(
      connect(s, { deviceId: ids[a]!, ifaceId: port(a, ia) }, { deviceId: ids[b]!, ifaceId: port(b, ib) })
    ).state
  }
  link('R1', 0, 'R2', 0)
  link('R2', 1, 'R3', 0)
  link('R3', 1, 'R1', 1)
  const ip = (name: string, i: number, address: string) => {
    s = unwrap(
      setInterfaceIpv4(s, ids[name]!, port(name, i), {
        addressing: 'static',
        address,
        mask: '30',
        gateway: null,
        dnsServers: []
      })
    ).state
    s = unwrap(setInterfaceEnabled(s, ids[name]!, port(name, i), true)).state
  }
  ip('R1', 0, '10.0.12.1')
  ip('R1', 1, '10.0.13.1')
  ip('R2', 0, '10.0.12.2')
  ip('R2', 1, '10.0.23.1')
  ip('R3', 0, '10.0.23.2')
  ip('R3', 1, '10.0.13.2')
  return s
}

async function cli(page: Page, device: string, lines: string[]): Promise<void> {
  if ((await page.getByTestId(`device-window-${device}`).count()) === 0)
    await page.getByTestId(`device-${device}`).dblclick()
  for (const line of lines) await typeCommand(page, device, line)
}

test('IOS : trois routeurs OSPF convergent, couper un lien recalcule les routes', async () => {
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await openLab(app, page, triangleLab())
    for (const [name, rid] of [
      ['R2', '2.2.2.2'],
      ['R3', '3.3.3.3'],
      ['R1', '1.1.1.1']
    ] as const) {
      await cli(page, name, [
        'en',
        'conf t',
        'router ospf 1',
        `router-id ${rid}`,
        'network 10.0.0.0 0.255.255.255 area 0',
        'end'
      ])
      if (name !== 'R1')
        await page.getByTestId(`device-window-${name}`).getByTestId('close-device-window').click()
    }
    const r1 = page.getByTestId('device-window-R1').getByTestId('terminal-ios')
    await expect(r1).toContainText(
      '%OSPF-5-ADJCHG: Process 1, Nbr 2.2.2.2 on GigabitEthernet0/0 from LOADING to FULL'
    )
    await typeCommand(page, 'R1', 'show ip route')
    await expect(r1).toContainText(/O\s+10\.0\.23\.0\/30 \[110\/2\] via 10\.0\.1[23]\.2/)
    await typeCommand(page, 'R1', 'show ip ospf neighbor')
    await expect(r1).toContainText(/3\.3\.3\.3\s+1\s+FULL\/DR/)

    // Coupure du lien R1–R2 côté R1 : 10.0.23.0/30 n'est plus joignable que par R3
    await cli(page, 'R1', ['conf t', 'int g0/0', 'shutdown', 'end', 'show ip route'])
    await expect(r1).toContainText('O        10.0.23.0/30 [110/2] via 10.0.13.2')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
