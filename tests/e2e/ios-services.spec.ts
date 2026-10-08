import { expect, test, type Page } from '@playwright/test'
import {
  addDevice,
  addScope,
  connect,
  createLab,
  installFeatures,
  setDhcpOptions,
  setInterfaceIpv4,
  unwrap,
  type DeviceKind,
  type IosModel,
  type LabState
} from '../../src/engine/index'
import { openLab } from './fixtures'
import { launchApp, openConsole, typeCommand } from './helpers'

/**
 * SRV1 (DHCP Windows, 10.0.0.1) et R2 (10.0.0.2) sur SW1, relié à R1 Gi0/0 (côté outside) ;
 * PC1 (DHCP) sur R1 Gi0/1 (LAN 192.168.20.0/24, côté inside). R2 n'a pas de route vers le LAN.
 */
function servicesLab(): LabState {
  let s = createLab()
  const ids: Record<string, string> = {}
  const add = (kind: DeviceKind, name: string, x: number, y: number, model?: IosModel) => {
    const r = unwrap(addDevice(s, { kind, position: { x, y }, name, ...(model ? { model } : {}) }))
    s = r.state
    ids[name] = r.value
  }
  add('server', 'SRV1', 100, 80)
  add('router', 'R2', 500, 80, 'c1921')
  add('switch', 'SW1', 300, 80, 'c2960')
  add('router', 'R1', 300, 250, 'c1921')
  add('client', 'PC1', 300, 420)
  const port = (name: string, i: number) => s.devices[ids[name]!]!.interfaces[i]!.id
  const cable = (a: string, ia: number, b: string, ib: number) => {
    s = unwrap(
      connect(s, { deviceId: ids[a]!, ifaceId: port(a, ia) }, { deviceId: ids[b]!, ifaceId: port(b, ib) })
    ).state
  }
  cable('SRV1', 0, 'SW1', 0)
  cable('R2', 0, 'SW1', 1)
  cable('R1', 0, 'SW1', 24)
  cable('PC1', 0, 'R1', 1)
  s = unwrap(
    setInterfaceIpv4(s, ids.SRV1!, port('SRV1', 0), {
      addressing: 'static',
      address: '10.0.0.1',
      mask: '24',
      gateway: '10.0.0.254',
      dnsServers: []
    })
  ).state
  s = unwrap(installFeatures(s, ids.SRV1!, ['DHCP'], { includeManagementTools: true })).state
  const scope = unwrap(
    addScope(s, ids.SRV1!, {
      name: 'LAN20',
      start: '192.168.20.100',
      end: '192.168.20.200',
      mask: '255.255.255.0'
    })
  )
  s = unwrap(
    setDhcpOptions(scope.state, ids.SRV1!, scope.value, { router: ['192.168.20.254'], dnsServers: [] })
  ).state
  return s
}

async function cli(page: Page, device: string, lines: string[]): Promise<void> {
  if ((await page.getByTestId(`device-window-${device}`).count()) === 0)
    await page.getByTestId(`device-${device}`).dblclick()
  for (const line of lines) await typeCommand(page, device, line)
}

test('IOS : bail obtenu via ip helper-address, sortie en PAT visible sur le routeur', async () => {
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await openLab(app, page, servicesLab())
    await cli(page, 'R2', ['en', 'conf t', 'int g0/0', 'ip address 10.0.0.2 255.255.255.0', 'no shut', 'end'])
    await page.getByTestId('device-window-R2').getByTestId('close-device-window').click()
    await cli(page, 'R1', [
      'en',
      'conf t',
      'int g0/0',
      'ip address 10.0.0.254 255.255.255.0',
      'no shut',
      'ip nat outside',
      'int g0/1',
      'ip address 192.168.20.254 255.255.255.0',
      'no shut',
      'ip helper-address 10.0.0.1',
      'ip nat inside',
      'exit',
      'access-list 1 permit 192.168.20.0 0.0.0.255',
      'ip nat inside source list 1 interface g0/0 overload',
      'end'
    ])
    await page.getByTestId('device-window-R1').getByTestId('close-device-window').click()

    // PC1 en DHCP : bail du serveur Windows, relayé par R1
    await page.getByTestId('device-PC1').dblclick()
    await page.getByTestId('device-window-PC1').getByTestId('nav-iface-Ethernet0').click()
    await page.getByTestId('device-window-PC1').getByTestId('ip-dhcp').check()
    await page.getByTestId('device-window-PC1').getByTestId('ip-apply').click()
    await openConsole(page, 'PC1', 'cmd')
    await typeCommand(page, 'PC1', 'ipconfig /renew')
    const pcTerm = page.getByTestId('device-window-PC1').getByTestId('terminal-cmd')
    await expect(pcTerm).toContainText('192.168.20.100')

    // R2 ne connaît pas 192.168.20.0/24 : la réponse revient grâce au PAT
    await typeCommand(page, 'PC1', 'ping 10.0.0.2')
    await expect(pcTerm).toContainText('Réponse de 10.0.0.2')
    await page.getByTestId('device-window-PC1').getByTestId('close-device-window').click()
    await cli(page, 'R1', ['show ip nat translations'])
    await expect(page.getByTestId('device-window-R1').getByTestId('terminal-ios')).toContainText(
      /icmp 10\.0\.0\.254:1\s+192\.168\.20\.100:1\s+10\.0\.0\.2:1\s+10\.0\.0\.2:1/
    )
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
