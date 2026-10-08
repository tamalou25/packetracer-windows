/**
 * Sécurité L2 des switchs IOS : DHCP snooping (serveur DHCP non autorisé rejeté), inspection ARP
 * dynamique (adresse hors base du snooping rejetée), switchport nonegotiate, règles d'audit.
 */
import { describe, expect, it } from 'vitest'
import {
  auditRules,
  dhcpAcquire,
  dhcpRenew,
  ping,
  setInterfaceIpv4,
  unwrap,
  type LabState
} from '@engine/index'
import { add, cable, createLab, setIp } from '../helpers'
import { addIos, IosConsole, type SharedLab } from './helpers'

const rule = (id: string) => auditRules().find((r) => r.id === id)!
const nic = (s: LabState, id: string) => s.devices[id]!.interfaces[0]!.id

/**
 * SW1 (2960) : PC1 (DHCP) Fa0/1, R2 serveur DHCP pirate (192.168.1.66) Fa0/3, PC3 (192.168.1.50
 * statique) Fa0/4, R1 serveur DHCP légitime (192.168.1.1) Gi0/1.
 */
function l2Lab() {
  const r1 = addIos(createLab(), 'c1921', 'R1')
  const r2 = addIos(r1.state, 'c1921', 'R2')
  const sw = addIos(r2.state, 'c2960', 'SW1')
  const pc1 = add(sw.state, 'client')
  const pc3 = add(pc1.state, 'client')
  let s = cable(pc3.state, pc1.id, 0, sw.id, 0)
  s = cable(s, r2.id, 0, sw.id, 2)
  s = cable(s, pc3.id, 0, sw.id, 3)
  s = cable(s, r1.id, 0, sw.id, 24)
  s = setIp(s, pc3.id, 0, '192.168.1.50/24', '192.168.1.1')
  s = unwrap(
    setInterfaceIpv4(s, pc1.id, nic(s, pc1.id), { addressing: 'dhcp', address: '', mask: '', dnsServers: [] })
  ).state
  const lab: SharedLab = { state: s }
  const server = (id: string, ip: string) =>
    new IosConsole(lab, id).lines(
      'en',
      'conf t',
      'int g0/0',
      `ip address ${ip} 255.255.255.0`,
      'no shut',
      'exit',
      `ip dhcp excluded-address 192.168.1.1 192.168.1.99`,
      'ip dhcp pool LAN',
      'network 192.168.1.0 255.255.255.0',
      `default-router ${ip}`,
      'end'
    )
  server(r1.id, '192.168.1.1')
  server(r2.id, '192.168.1.66')
  return { lab, sw: new IosConsole(lab, sw.id), pc1: pc1.id, pc3: pc3.id }
}

const acquire = (lab: SharedLab, pc: string) => {
  const op = dhcpAcquire(lab.state, pc, nic(lab.state, pc))
  lab.state = op.state
  return op
}
const gateway = (s: LabState, pc: string) => s.devices[pc]!.interfaces[0]!.dhcpLease?.gateway

describe('DHCP snooping', () => {
  it('sans snooping, le serveur pirate répond le premier ; avec, seul le port de confiance passe', () => {
    const { lab, sw, pc1 } = l2Lab()
    const before = dhcpAcquire(lab.state, pc1, nic(lab.state, pc1))
    expect(before.outcome).toBe('bound')
    expect(gateway(before.state, pc1)).toBe('192.168.1.66')

    sw.lines(
      'en',
      'conf t',
      'ip dhcp snooping',
      'ip dhcp snooping vlan 1',
      'int g0/1',
      'ip dhcp snooping trust',
      'end'
    )
    const op = acquire(lab, pc1)
    expect(op.outcome).toBe('bound')
    expect(gateway(lab.state, pc1)).toBe('192.168.1.1')
    const dropped = op.trace.events.find((e) => e.outcome === 'dropped' && e.note.includes('DHCP snooping'))
    expect(dropped?.note).toContain('Fa0/3 n’est pas un port de confiance')
  })

  it('renouvellement : le bail du serveur pirate est abandonné au profit du serveur de confiance', () => {
    const { lab, sw, pc1 } = l2Lab()
    acquire(lab, pc1)
    expect(gateway(lab.state, pc1)).toBe('192.168.1.66')
    sw.lines(
      'en',
      'conf t',
      'ip dhcp snooping',
      'ip dhcp snooping vlan 1',
      'int g0/1',
      'ip dhcp snooping trust',
      'end'
    )
    const op = dhcpRenew(lab.state, pc1, nic(lab.state, pc1))
    expect(op.outcome).toBe('bound')
    expect(gateway(op.state, pc1)).toBe('192.168.1.1')
  })

  it('port légitime non déclaré de confiance : aucun bail', () => {
    const { lab, sw, pc1 } = l2Lab()
    sw.lines('en', 'conf t', 'ip dhcp snooping', 'ip dhcp snooping vlan 1', 'end')
    expect(acquire(lab, pc1).outcome).not.toBe('bound')
  })

  it('configuration et show ip dhcp snooping', () => {
    const { sw } = l2Lab()
    sw.lines(
      'en',
      'conf t',
      'ip dhcp snooping vlan 1',
      'ip dhcp snooping',
      'int g0/1',
      'ip dhcp snooping trust',
      'end'
    )
    const run = sw.run('show running-config')
    expect(run).toContain('ip dhcp snooping vlan 1')
    expect(run).toContain('ip dhcp snooping')
    expect(run).toContain(' ip dhcp snooping trust')
    const show = sw.run('show ip dhcp snooping')
    expect(show[0]).toBe('Switch DHCP snooping is enabled')
    expect(show.some((l) => /^Gi0\/1 +yes/.test(l))).toBe(true)
    sw.lines('conf t', 'no ip dhcp snooping', 'end')
    expect(sw.run('show ip dhcp snooping')[0]).toBe('Switch DHCP snooping is disabled')
  })
})

describe('Inspection ARP dynamique', () => {
  it('un poste à adresse statique est bloqué, un bail DHCP passe ; sans DAI tout passe', () => {
    const { lab, sw, pc1, pc3 } = l2Lab()
    sw.lines(
      'en',
      'conf t',
      'ip dhcp snooping',
      'ip dhcp snooping vlan 1',
      'ip arp inspection vlan 1',
      'int g0/1',
      'ip dhcp snooping trust',
      'ip arp inspection trust',
      'end'
    )
    acquire(lab, pc1)
    const ok = ping(lab.state, pc1, '192.168.1.1')
    expect(ok.ok && ok.value.success).toBe(true)
    const refused = ping(lab.state, pc3, '192.168.1.1')
    expect(refused.ok && refused.value.success).toBe(false)
    const note = refused.ok ? refused.value.trace.events.find((e) => e.outcome === 'dropped')?.note : ''
    expect(note).toContain('inspection ARP')
    expect(note).toContain('192.168.1.50')
    sw.lines('conf t', 'no ip arp inspection vlan 1', 'end')
    const after = ping(lab.state, pc3, '192.168.1.1')
    expect(after.ok && after.value.success).toBe(true)
    expect(sw.run('show running-config')).toContain(' ip arp inspection trust')
  })
})

describe('DTP, VLAN natif et audit', () => {
  it('switchport nonegotiate et VLAN natif dédié corrigent les règles iosDtp et iosNativeVlan', () => {
    const { lab, sw } = l2Lab()
    sw.lines('en', 'conf t', 'int g0/2', 'switchport mode trunk', 'end')
    expect(rule('iosDtp').check(lab.state)).toEqual([{ object: 'SW1 Gi0/2', detail: expect.any(String) }])
    expect(rule('iosNativeVlan').check(lab.state)).toHaveLength(1)
    sw.lines(
      'conf t',
      'vlan 999',
      'int g0/2',
      'switchport nonegotiate',
      'switchport trunk native vlan 999',
      'end'
    )
    expect(sw.run('show running-config')).toContain(' switchport nonegotiate')
    expect(rule('iosDtp').check(lab.state)).toEqual([])
    expect(rule('iosNativeVlan').check(lab.state)).toEqual([])
  })

  it('DHCP snooping, DAI et port-security : signalés puis corrigés', () => {
    const { lab, sw } = l2Lab()
    expect(rule('iosDhcpSnooping').check(lab.state)[0]?.detail).toContain('1')
    expect(rule('iosArpInspection').check(lab.state)).toHaveLength(1)
    expect(rule('iosPortSecurity').check(lab.state)[0]?.detail).toContain('Fa0/1')
    sw.lines('en', 'conf t', 'ip dhcp snooping', 'ip dhcp snooping vlan 1', 'ip arp inspection vlan 1')
    for (const port of ['f0/1', 'f0/3', 'f0/4', 'g0/1'])
      sw.lines(`int ${port}`, 'switchport mode access', 'switchport port-security', 'exit')
    sw.run('end')
    expect(rule('iosDhcpSnooping').check(lab.state)).toEqual([])
    expect(rule('iosArpInspection').check(lab.state)).toEqual([])
    expect(rule('iosPortSecurity').check(lab.state)).toEqual([])
  })
})
