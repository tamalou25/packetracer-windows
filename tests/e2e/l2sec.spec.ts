import { expect, test, type Page } from '@playwright/test'
import {
  addDevice,
  connect,
  createLab,
  runIosScript,
  setInterfaceIpv4,
  unwrap,
  type DeviceKind,
  type IosModel,
  type LabState
} from '../../src/engine/index'
import { openLab } from './fixtures'
import { launchApp, openConsole, typeCommand } from './helpers'

/** SW1 : PC1 (DHCP) Fa0/1, R2 serveur DHCP pirate Fa0/3, R1 serveur DHCP légitime Gi0/1. */
function rogueLab(): LabState {
  let s = createLab()
  const ids: Record<string, string> = {}
  const add = (kind: DeviceKind, name: string, x: number, y: number, model?: IosModel) => {
    const r = unwrap(addDevice(s, { kind, position: { x, y }, name, ...(model ? { model } : {}) }))
    s = r.state
    ids[name] = r.value
  }
  add('switch', 'SW1', 330, 250, 'c2960')
  add('client', 'PC1', 100, 400)
  add('router', 'R1', 560, 250, 'c1921')
  add('router', 'R2', 330, 450, 'c1921')
  const port = (name: string, i: number) => s.devices[ids[name]!]!.interfaces[i]!.id
  const link = (a: string, ia: number, b: string, ib: number) => {
    s = unwrap(
      connect(s, { deviceId: ids[a]!, ifaceId: port(a, ia) }, { deviceId: ids[b]!, ifaceId: port(b, ib) })
    ).state
  }
  link('PC1', 0, 'SW1', 0)
  link('R2', 0, 'SW1', 2)
  link('R1', 0, 'SW1', 24)
  s = unwrap(
    setInterfaceIpv4(s, ids.PC1!, port('PC1', 0), {
      addressing: 'dhcp',
      address: '',
      mask: '',
      dnsServers: []
    })
  ).state
  const server = (name: string, ip: string) => {
    s = runIosScript(s, ids[name]!, [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      `ip address ${ip} 255.255.255.0`,
      'no shutdown',
      'exit',
      'ip dhcp excluded-address 192.168.1.1 192.168.1.99',
      'ip dhcp pool LAN',
      'network 192.168.1.0 255.255.255.0',
      `default-router ${ip}`,
      'end'
    ])
  }
  server('R1', '192.168.1.1')
  server('R2', '192.168.1.66')
  return s
}

async function renew(page: Page): Promise<void> {
  await openConsole(page, 'PC1', 'cmd')
  await typeCommand(page, 'PC1', 'ipconfig /renew')
}

test('DHCP snooping : le serveur pirate est écarté, l’audit le signale puis le valide', async () => {
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await openLab(app, page, rogueLab())
    await page.getByTestId('right-tab-audit').click()
    await expect(page.getByTestId('audit-iosDhcpSnooping')).toContainText('SW1')

    // Sans protection : le serveur pirate répond le premier
    await renew(page)
    const term = page.getByTestId('device-window-PC1').getByTestId('terminal-cmd')
    await expect(term).toContainText(/Passerelle par défaut[ .]*: 192\.168\.1\.66/)
    await page.getByTestId('device-window-PC1').getByTestId('close-device-window').click()

    // Console du switch : DHCP snooping, port de confiance vers R1
    await page.getByTestId('device-SW1').dblclick()
    for (const line of [
      'en',
      'conf t',
      'ip dhcp snooping',
      'ip dhcp snooping vlan 1',
      'int g0/1',
      'ip dhcp snooping trust',
      'end',
      'show ip dhcp snooping'
    ])
      await typeCommand(page, 'SW1', line)
    await expect(page.getByTestId('device-window-SW1').getByTestId('terminal-ios')).toContainText(
      'Switch DHCP snooping is enabled'
    )
    await page.getByTestId('device-window-SW1').getByTestId('close-device-window').click()
    await expect(page.getByTestId('audit-iosDhcpSnooping')).toHaveCount(0)

    // Le bail vient désormais du serveur légitime
    await renew(page)
    await expect(term).toContainText(/Passerelle par défaut[ .]*: 192\.168\.1\.1(?!\d)/)
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
