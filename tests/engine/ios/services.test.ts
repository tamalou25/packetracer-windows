/**
 * Services IP IOS : relais DHCP vers un serveur Windows, serveur DHCP IOS, NAT/PAT et NAT statique
 * (traductions visibles dans show ip nat translations et dans la trace de Simulation).
 */
import { describe, expect, it } from 'vitest'
import {
  addScope,
  dhcpAcquire,
  executeLine,
  createShellSession,
  installFeatures,
  ping,
  setDhcpOptions,
  setInterfaceIpv4,
  unwrap,
  type LabState
} from '@engine/index'
import { add, cable, createLab, setIp } from '../helpers'
import { addIos, IosConsole, type SharedLab } from './helpers'

const dhcpClient = (s: LabState, id: string): LabState =>
  unwrap(
    setInterfaceIpv4(s, id, s.devices[id]!.interfaces[0]!.id, {
      addressing: 'dhcp',
      address: '',
      mask: '',
      dnsServers: []
    })
  ).state

describe('relais DHCP vers Windows Server', () => {
  it('un poste obtient une adresse du serveur Windows via ip helper-address', () => {
    // SRV1 (DHCP) — R1 Gi0/0 (10.0.0.254) ; R1 Gi0/1 (192.168.20.254) — PC1 (DHCP)
    const r1 = addIos(createLab(), 'c1921')
    const srv = add(r1.state, 'server')
    const pc = add(srv.state, 'client')
    let s = cable(pc.state, srv.id, 0, r1.id, 0)
    s = cable(s, pc.id, 0, r1.id, 1)
    s = setIp(s, srv.id, 0, '10.0.0.1/24', '10.0.0.254')
    s = unwrap(installFeatures(s, srv.id, ['DHCP'], { includeManagementTools: true })).state
    const scope = unwrap(
      addScope(s, srv.id, {
        name: 'LAN20',
        start: '192.168.20.100',
        end: '192.168.20.200',
        mask: '255.255.255.0'
      })
    )
    s = unwrap(
      setDhcpOptions(scope.state, srv.id, scope.value, { router: ['192.168.20.254'], dnsServers: [] })
    ).state
    s = dhcpClient(s, pc.id)
    const lab: SharedLab = { state: s }
    const c = new IosConsole(lab, r1.id)
    c.lines('en', 'conf t', 'int g0/0', 'ip address 10.0.0.254 255.255.255.0', 'no shut')
    c.lines('int g0/1', 'ip address 192.168.20.254 255.255.255.0', 'no shut', 'end')
    expect(dhcpAcquire(lab.state, pc.id, lab.state.devices[pc.id]!.interfaces[0]!.id).outcome).toBe('failed')
    c.lines('conf t', 'int g0/1', 'ip helper-address 10.0.0.1', 'end')
    const op = dhcpAcquire(lab.state, pc.id, lab.state.devices[pc.id]!.interfaces[0]!.id)
    expect(op.outcome).toBe('bound')
    expect(op.address).toBe('192.168.20.100')
    expect(c.run('show running-config')).toContain(' ip helper-address 10.0.0.1')
  })
})

describe('serveur DHCP IOS', () => {
  function dhcpLab() {
    const r1 = addIos(createLab(), 'c1921')
    const pc1 = add(r1.state, 'client')
    const sw = addIos(pc1.state, 'c2960')
    const pc2 = add(sw.state, 'client')
    let s = cable(pc2.state, r1.id, 0, sw.id, 24)
    s = cable(s, pc1.id, 0, sw.id, 0)
    s = cable(s, pc2.id, 0, sw.id, 1)
    s = dhcpClient(dhcpClient(s, pc1.id), pc2.id)
    const lab: SharedLab = { state: s }
    const c = new IosConsole(lab, r1.id)
    c.lines('en', 'conf t', 'int g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shut', 'exit')
    c.lines('ip dhcp excluded-address 192.168.1.1 192.168.1.10')
    c.lines('ip dhcp pool LAN', 'network 192.168.1.0 255.255.255.0', 'default-router 192.168.1.1')
    c.lines('dns-server 8.8.8.8 1.1.1.1', 'domain-name lab.local', 'end')
    return { lab, c, pc1: pc1.id, pc2: pc2.id }
  }

  it('pool, exclusions, options ; show ip dhcp binding', () => {
    const { lab, c, pc1, pc2 } = dhcpLab()
    const a = dhcpAcquire(lab.state, pc1, lab.state.devices[pc1]!.interfaces[0]!.id)
    expect(a.outcome).toBe('bound')
    expect(a.address).toBe('192.168.1.11')
    const lease = a.state.devices[pc1]!.interfaces[0]!.dhcpLease
    expect(lease).toMatchObject({
      gateway: '192.168.1.1',
      dnsServers: ['8.8.8.8', '1.1.1.1'],
      dnsSuffix: 'lab.local'
    })
    lab.state = a.state
    const b = dhcpAcquire(lab.state, pc2, lab.state.devices[pc2]!.interfaces[0]!.id)
    expect(b.address).toBe('192.168.1.12')
    lab.state = b.state
    const out = c.run('show ip dhcp binding')
    expect(out.slice(0, 4)).toEqual([
      'Bindings from all pools not associated with VRF:',
      'IP address          Client-ID/              Lease expiration        Type',
      '                    Hardware address/',
      '                    User name'
    ])
    expect(out[4]).toMatch(
      /^192\.168\.1\.11 {8}01[0-9a-f]{2}\.[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{2} {7}Mar 0[12] 1993 \d\d:\d\d [AP]M {4}Automatic$/
    )
    const run = c.run('show running-config')
    expect(run).toContain('ip dhcp excluded-address 192.168.1.1 192.168.1.10')
    const at = run.indexOf('ip dhcp pool LAN')
    expect(run.slice(at, at + 5)).toEqual([
      'ip dhcp pool LAN',
      ' network 192.168.1.0 255.255.255.0',
      ' default-router 192.168.1.1',
      ' dns-server 8.8.8.8 1.1.1.1',
      ' domain-name lab.local'
    ])
  })

  it('les baux ne sont pas enregistrés dans la startup-config', () => {
    const { lab, c, pc1 } = dhcpLab()
    lab.state = dhcpAcquire(lab.state, pc1, lab.state.devices[pc1]!.interfaces[0]!.id).state
    c.run('write memory')
    const device = lab.state.devices[c.session.deviceId]
    expect(device?.kind === 'router' && device.ios?.startup?.config.dhcpServer?.scopes[0]?.leases).toEqual([])
  })
})

describe('NAT / PAT', () => {
  /** PC1 (192.168.1.10) — R1 Gi0/0 inside ; R1 Gi0/1 outside (203.0.113.1/30) — R2 (203.0.113.2), LAN 8.8.8.0/24. */
  function natLab() {
    const r1 = addIos(createLab(), 'c1921')
    const r2 = addIos(r1.state, 'c1921')
    const pc = add(r2.state, 'client')
    let s = cable(pc.state, pc.id, 0, r1.id, 0)
    s = cable(s, r1.id, 1, r2.id, 0)
    s = setIp(s, pc.id, 0, '192.168.1.10/24', '192.168.1.1')
    const lab: SharedLab = { state: s }
    const c1 = new IosConsole(lab, r1.id)
    const c2 = new IosConsole(lab, r2.id)
    c1.lines('en', 'conf t', 'int g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shut', 'ip nat inside')
    c1.lines('int g0/1', 'ip address 203.0.113.1 255.255.255.252', 'no shut', 'ip nat outside', 'exit')
    c1.lines('ip route 0.0.0.0 0.0.0.0 203.0.113.2')
    // R2 (FAI) ne connaît pas 192.168.1.0/24
    c2.lines('en', 'conf t', 'int g0/0', 'ip address 203.0.113.2 255.255.255.252', 'no shut', 'end')
    return { lab, c1, c2, pc: pc.id }
  }

  const pcPing = (lab: SharedLab, pc: string, target: string) => {
    const session = createShellSession(lab.state, pc, 'cmd')
    const r = executeLine(lab.state, session, `ping ${target}`)
    lab.state = r.state
    return r
  }

  it('sans NAT, la réponse ne revient pas', () => {
    const { lab, pc } = natLab()
    const r = ping(lab.state, pc, '203.0.113.2')
    expect(r.ok && r.value.success).toBe(false)
  })

  it('PAT : le poste sort avec l’adresse de l’interface, traduction visible', () => {
    const { lab, c1, pc } = natLab()
    c1.lines(
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'ip nat inside source list 1 interface g0/1 overload',
      'end'
    )
    const r = pcPing(lab, pc, '203.0.113.2')
    expect(r.output.map((l) => l.text).join('\n')).toContain('Réponse de 203.0.113.2')
    // Simulation : la traduction est expliquée dans la trace
    const notes = r.trace?.events.map((e) => e.note ?? '') ?? []
    expect(
      notes.some((n) => n.includes('(NAT PAT) traduit l’adresse source 192.168.1.10 en 203.0.113.1'))
    ).toBe(true)
    expect(c1.run('show ip nat translations')).toEqual([
      'Pro  Inside global         Inside local          Outside local         Outside global',
      'icmp 203.0.113.1:1         192.168.1.10:1        203.0.113.2:1         203.0.113.2:1'
    ])
    const run = c1.run('show running-config')
    expect(run).toContain('ip nat inside source list 1 interface GigabitEthernet0/1 overload')
    expect(run).toContain('access-list 1 permit 192.168.1.0 0.0.0.255')
    expect(run).toContain(' ip nat inside')
    c1.run('clear ip nat translation *')
    expect(c1.run('show ip nat translations')).toHaveLength(1)
  })

  it('liste d’accès qui n’autorise pas la source : pas de traduction', () => {
    const { lab, c1, pc } = natLab()
    c1.lines(
      'access-list 1 permit host 192.168.1.99',
      'ip nat inside source list 1 interface g0/1 overload',
      'end'
    )
    const r = ping(lab.state, pc, '203.0.113.2')
    expect(r.ok && r.value.success).toBe(false)
  })

  it('NAT statique : joignable depuis l’extérieur par l’adresse globale', () => {
    const { lab, c1, c2, pc } = natLab()
    c1.lines('ip nat inside source static 192.168.1.10 203.0.113.1', 'end')
    expect(
      pcPing(lab, pc, '203.0.113.2')
        .output.map((l) => l.text)
        .join('\n')
    ).toContain('Réponse de 203.0.113.2')
    const out = c2.run('ping 203.0.113.1')
    expect(out[2]).toBe('!!!!!')
    expect(c1.run('show ip nat translations')).toContain(
      '--- 203.0.113.1           192.168.1.10          ---                   ---'
    )
  })
})
