import { describe, expect, it } from 'vitest'
import {
  addExclusion,
  addReservation,
  addScope,
  autoConfigureDhcp,
  dhcpAcquire,
  dhcpRelease,
  dhcpRenew,
  effectiveIpv4,
  installFeatures,
  setDhcpOptions,
  setInterfaceIpv4,
  unwrap,
  type LabState
} from '@engine/index'
import { build, cable, setIp } from '../helpers'
import { run } from '../shell/helpers'

/** SRV1 (DHCP, 192.168.1.1) + PC1 + PC2 sur SW1, R1 vers un second LAN avec PC3. */
function lab(opts: { scope?: boolean } = { scope: true }) {
  const { state, ids } = build([
    ['server', 'SRV1'],
    ['client', 'PC1'],
    ['client', 'PC2'],
    ['switch', 'SW1'],
    ['router', 'R1'],
    ['switch', 'SW2'],
    ['client', 'PC3']
  ])
  let s = cable(state, ids.SRV1!, 0, ids.SW1!, 0)
  s = cable(s, ids.PC1!, 0, ids.SW1!, 1)
  s = cable(s, ids.PC2!, 0, ids.SW1!, 2)
  s = cable(s, ids.SW1!, 3, ids.R1!, 0)
  s = cable(s, ids.R1!, 1, ids.SW2!, 0)
  s = cable(s, ids.PC3!, 0, ids.SW2!, 1)
  s = setIp(s, ids.SRV1!, 0, '192.168.1.1/24')
  s = setIp(s, ids.R1!, 0, '192.168.1.254/24')
  s = setIp(s, ids.R1!, 1, '192.168.2.254/24')
  s = unwrap(installFeatures(s, ids.SRV1!, ['DHCP'], { includeManagementTools: true })).state
  if (opts.scope) {
    s = unwrap(
      addScope(s, ids.SRV1!, {
        name: 'LAN',
        start: '192.168.1.100',
        end: '192.168.1.110',
        mask: '255.255.255.0'
      })
    ).state
    s = unwrap(
      setDhcpOptions(s, ids.SRV1!, '192.168.1.0', { router: ['192.168.1.254'], dnsDomain: 'lab.local' })
    ).state
  }
  return { s, ids }
}

function leaseOf(s: LabState, id: string) {
  return s.devices[id]!.interfaces[0]!.dhcpLease
}

describe('DHCP : DORA', () => {
  it('attribue la première adresse libre avec les options 003 et 015', () => {
    const { s, ids } = lab()
    const op = dhcpAcquire(s, ids.PC1!, s.devices[ids.PC1!]!.interfaces[0]!.id)
    expect(op.outcome).toBe('bound')
    expect(leaseOf(op.state, ids.PC1!)).toMatchObject({
      address: '192.168.1.100',
      prefixLength: 24,
      gateway: '192.168.1.254',
      dnsSuffix: 'lab.local'
    })
    const types = op.trace.events
      .filter((e) => e.protocol === 'DHCP')
      .map((e) => e.layers.at(-1)?.fields[0]?.[1])
    expect(new Set(types)).toEqual(new Set(['DHCPDISCOVER', 'DHCPOFFER', 'DHCPREQUEST', 'DHCPACK']))
    const srv = op.state.devices[ids.SRV1!]
    expect(srv?.kind === 'server' && srv.services.dhcp?.scopes[0]?.leases[0]?.hostName).toBe('PC1')
  })

  it('respecte exclusions et réservations', () => {
    const { s: base, ids } = lab()
    let s = unwrap(addExclusion(base, ids.SRV1!, '192.168.1.0', '192.168.1.100', '192.168.1.102')).state
    const pc2mac = s.devices[ids.PC2!]!.interfaces[0]!.mac
    s = unwrap(
      addReservation(s, ids.SRV1!, '192.168.1.0', {
        ip: '192.168.1.110',
        mac: pc2mac.replace(/-/g, ':'),
        name: 'PC2'
      })
    ).state
    s = autoConfigureDhcp(s).state
    expect(leaseOf(s, ids.PC1!)?.address).toBe('192.168.1.103')
    expect(leaseOf(s, ids.PC2!)?.address).toBe('192.168.1.110')
  })

  it('ne traverse pas le routeur (diffusion) : APIPA de l’autre côté', () => {
    const { s, ids } = lab()
    const op = dhcpAcquire(s, ids.PC3!, s.devices[ids.PC3!]!.interfaces[0]!.id)
    expect(op.outcome).toBe('failed')
    expect(effectiveIpv4(op.state.devices[ids.PC3!]!.interfaces[0]!)?.source).toBe('apipa')
    // Le routeur reçoit la diffusion mais ne la relaie pas
    expect(op.trace.events.some((e) => e.toDeviceId === ids.R1)).toBe(true)
    expect(op.trace.events.some((e) => e.toDeviceId === ids.SRV1)).toBe(false)
  })

  it('n’attribue rien sans étendue et épuise la plage', () => {
    const empty = lab({ scope: false })
    expect(
      dhcpAcquire(empty.s, empty.ids.PC1!, empty.s.devices[empty.ids.PC1!]!.interfaces[0]!.id).outcome
    ).toBe('failed')
    const { s: base, ids } = lab()
    let s = unwrap(addExclusion(base, ids.SRV1!, '192.168.1.0', '192.168.1.100', '192.168.1.109')).state
    s = autoConfigureDhcp(s).state
    const leased = [ids.PC1!, ids.PC2!].map((id) => leaseOf(s, id)?.address ?? null)
    expect(leased.filter((a) => a !== null)).toEqual(['192.168.1.110'])
  })

  it('évite une adresse déjà utilisée (BAD_ADDRESS)', () => {
    const { s: base, ids } = lab()
    const s = setIp(base, ids.PC2!, 0, '192.168.1.100/24')
    const op = dhcpAcquire(s, ids.PC1!, s.devices[ids.PC1!]!.interfaces[0]!.id)
    expect(leaseOf(op.state, ids.PC1!)?.address).toBe('192.168.1.101')
    const srv = op.state.devices[ids.SRV1!]
    expect(
      srv?.kind === 'server' &&
        srv.services.dhcp?.scopes[0]?.leases.some((l) => l.state === 'BadAddress' && l.ip === '192.168.1.100')
    ).toBe(true)
  })

  it('un serveur à adresse dynamique ne distribue pas', () => {
    const { s: base, ids } = lab()
    const srvIface = base.devices[ids.SRV1!]!.interfaces[0]!.id
    const s = unwrap(setInterfaceIpv4(base, ids.SRV1!, srvIface, { addressing: 'dhcp' })).state
    expect(dhcpAcquire(s, ids.PC1!, s.devices[ids.PC1!]!.interfaces[0]!.id).outcome).toBe('failed')
  })

  it('release puis renew', () => {
    const { s: base, ids } = lab()
    const iface = base.devices[ids.PC1!]!.interfaces[0]!.id
    let s = dhcpAcquire(base, ids.PC1!, iface).state
    const renew = dhcpRenew(s, ids.PC1!, iface)
    expect(renew.outcome).toBe('renewed')
    expect(renew.trace.events.length).toBeGreaterThan(0)
    s = dhcpRelease(renew.state, ids.PC1!, iface).state
    expect(effectiveIpv4(s.devices[ids.PC1!]!.interfaces[0]!)).toBeNull()
    const srv = s.devices[ids.SRV1!]
    expect(srv?.kind === 'server' && srv.services.dhcp?.scopes[0]?.leases).toHaveLength(0)
    // Une carte libérée n'est pas reconfigurée automatiquement
    expect(leaseOf(autoConfigureDhcp(s).state, ids.PC1!)).toBeNull()
    s = dhcpRenew(s, ids.PC1!, iface).state
    expect(leaseOf(s, ids.PC1!)?.address).toBe('192.168.1.100')
  })
})

describe('DHCP : validations', () => {
  it('refuse une étendue incohérente', () => {
    const { s, ids } = lab({ scope: false })
    expect(
      addScope(s, ids.SRV1!, { name: 'X', start: '192.168.1.10', end: '192.168.2.10', mask: '24' }).ok
    ).toBe(false)
    expect(
      addScope(s, ids.SRV1!, { name: 'X', start: '192.168.1.50', end: '192.168.1.10', mask: '24' }).ok
    ).toBe(false)
    const ok = unwrap(
      addScope(s, ids.SRV1!, { name: 'X', start: '192.168.1.10', end: '192.168.1.50', mask: '24' })
    ).state
    const dup = addScope(ok, ids.SRV1!, { name: 'Y', start: '192.168.1.60', end: '192.168.1.70', mask: '24' })
    expect(!dup.ok && dup.error.message).toContain('existe déjà')
  })

  it('refuse une option DNS ne pointant pas vers un serveur DNS (sauf -Force)', () => {
    const { s, ids } = lab()
    const bad = setDhcpOptions(s, ids.SRV1!, '192.168.1.0', { dnsServers: ['192.168.1.50'] })
    expect(!bad.ok && bad.error.message).toContain('n’est pas un serveur DNS valide')
    expect(
      setDhcpOptions(s, ids.SRV1!, '192.168.1.0', { dnsServers: ['192.168.1.50'], force: true }).ok
    ).toBe(true)
    expect(setDhcpOptions(s, ids.SRV1!, '192.168.1.0', { dnsServers: ['8.8.8.8'] }).ok).toBe(true)
  })
})

describe('DHCP : console', () => {
  it('cmdlets et ipconfig /renew', () => {
    const { s: base, ids } = lab({ scope: false })
    let r = run(
      base,
      ids.SRV1!,
      'Add-DhcpServerv4Scope -Name "LAN" -StartRange 192.168.1.100 -EndRange 192.168.1.200 -SubnetMask 255.255.255.0'
    )
    expect(r.errors).toBe('')
    r = run(r.state, ids.SRV1!, 'Set-DhcpServerv4OptionValue -ScopeId 192.168.1.0 -Router 192.168.1.254')
    expect(r.errors).toBe('')
    r = run(r.state, ids.SRV1!, 'Get-DhcpServerv4Scope')
    expect(r.text).toMatch(/192\.168\.1\.0\s+255\.255\.255\.0\s+LAN\s+Active/)
    const renew = run(r.state, ids.PC1!, 'ipconfig /renew', { shell: 'cmd' })
    expect(renew.text).toMatch(/Adresse IPv4[ .]*: 192\.168\.1\.100/)
    expect(renew.traceEvents).toBeGreaterThan(0)
    const leases = run(renew.state, ids.SRV1!, 'Get-DhcpServerv4Lease -ScopeId 192.168.1.0')
    expect(leases.text).toContain('PC1')
    const release = run(renew.state, ids.PC1!, 'ipconfig /release', { shell: 'cmd' })
    expect(release.text).not.toMatch(/Adresse IPv4[ .]*: 192/)
  })

  it('Add-DhcpServerInDC exige un domaine', () => {
    const { s, ids } = lab()
    expect(run(s, ids.SRV1!, 'Add-DhcpServerInDC').errors).toContain('n’est pas membre d’un domaine')
  })

  it('les cmdlets DHCP exigent les outils de gestion', () => {
    const { state, ids } = build([['server', 'SRV1']])
    const s = unwrap(installFeatures(state, ids.SRV1!, ['DHCP'])).state
    expect(run(s, ids.SRV1!, 'Get-DhcpServerv4Scope').errors).toContain("n'est pas reconnu")
  })
})
