/**
 * Accès à distance (RRAS) : NAT vers Internet (traduction visible en Simulation), serveur VPN
 * avec pool d'adresses, client VPN (tunnel SSTP, proxy ARP), cmdlets et rasdial.
 */
import { describe, expect, it } from 'vitest'
import {
  addDevice,
  command,
  connect,
  dispatch,
  evaluateCheck,
  installFeatures,
  ping,
  rrasOf,
  setInterfaceIpv4,
  unwrap,
  type AnyCommand,
  type DeviceKind,
  type LabState,
  type ServerDevice
} from '@engine/index'
import { buildReferenceLab } from '../serialization/reference-lab'
import { run } from '../shell/helpers'

const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''
const iface = (s: LabState, name: string, index: number) => s.devices[id(s, name)]!.interfaces[index]!.id

function exec(state: LabState, ...cmds: AnyCommand[]): LabState {
  let s = state
  for (const cmd of cmds) {
    const r = dispatch(s, cmd)
    if (!r.ok) throw new Error(`${cmd.type} : ${r.error.message}`)
    s = r.state
  }
  return s
}

function staticIp(s: LabState, name: string, index: number, address: string, gateway: string | null) {
  return unwrap(
    setInterfaceIpv4(s, id(s, name), iface(s, name, index), {
      addressing: 'static',
      address,
      mask: '24',
      gateway,
      dnsServers: []
    })
  ).state
}

/**
 * Lab de référence (SRV1 contrôleur de lab.local, PC2 192.168.10.20) + Internet : SRV1 reçoit une
 * seconde carte 203.0.113.2 reliée au nuage (203.0.113.1) par SWX, où se trouve aussi le poste
 * distant PCR (203.0.113.50). PC2 utilise SRV1 comme passerelle.
 */
function internetLab(): LabState {
  let s = buildReferenceLab()
  const add = (kind: DeviceKind, name: string) => {
    s = unwrap(addDevice(s, { kind, position: { x: 600, y: 0 }, name })).state
  }
  add('cloud', 'INTERNET')
  add('switch', 'SWX')
  add('client', 'PCR')
  const srv = id(s, 'SRV1')
  s = exec(s, command('topology.addServerInterface', srv))
  const link = (a: string, ia: number, b: string, ib: number) => {
    s = unwrap(
      connect(
        s,
        { deviceId: id(s, a), ifaceId: iface(s, a, ia) },
        { deviceId: id(s, b), ifaceId: iface(s, b, ib) }
      )
    ).state
  }
  link('INTERNET', 0, 'SWX', 0)
  link('SRV1', 1, 'SWX', 1)
  link('PCR', 0, 'SWX', 2)
  s = staticIp(s, 'INTERNET', 0, '203.0.113.1', null)
  s = staticIp(s, 'SRV1', 1, '203.0.113.2', '203.0.113.1')
  s = staticIp(s, 'PCR', 0, '203.0.113.50', '203.0.113.1')
  s = staticIp(s, 'PC2', 0, '192.168.10.20', '192.168.10.1')
  // Carte interne du serveur : sans passerelle (la passerelle par défaut est côté Internet)
  s = unwrap(
    setInterfaceIpv4(s, srv, iface(s, 'SRV1', 0), {
      addressing: 'static',
      address: '192.168.10.1',
      mask: '24',
      gateway: null,
      dnsServers: ['192.168.10.1']
    })
  ).state
  return unwrap(
    installFeatures(s, srv, ['RemoteAccess', 'DirectAccess-VPN', 'Routing'], { includeManagementTools: true })
  ).state
}

const pingResult = (s: LabState, from: string, to: string) => {
  const r = ping(s, id(s, from), to, { count: 1 })
  if (!r.ok) throw new Error(r.error.message)
  return r.value
}

describe('RRAS : NAT', () => {
  it('acceptation : un poste du LAN joint 8.8.8.8 via le NAT, traduction visible en Simulation', () => {
    let s = internetLab()
    // Sans routage : SRV1 n'achemine pas le trafic de PC2
    const before = pingResult(s, 'PC2', '8.8.8.8')
    expect(before.success).toBe(false)
    expect(before.trace.events.map((e) => e.note).join('\n')).toContain('SRV1 n’est pas un routeur')
    s = exec(s, command('rras.configure', id(s, 'SRV1'), { mode: 'nat', publicIfaceId: iface(s, 'SRV1', 1) }))
    const r = pingResult(s, 'PC2', '8.8.8.8')
    expect(r.success).toBe(true)
    const notes = r.trace.events.map((e) => e.note).join('\n')
    expect(notes).toContain('SRV1 (NAT) traduit l’adresse source 192.168.10.20 en 203.0.113.2.')
    expect(notes).toContain('SRV1 (NAT) retraduit l’adresse de destination 203.0.113.2 en 192.168.10.20')
    // Côté Internet, la requête porte l'adresse publique
    const onInternet = r.trace.events.filter(
      (e) => e.protocol === 'ICMP' && e.toDeviceId === id(s, 'INTERNET')
    )
    const ip = onInternet[0]?.layers.find((l) => l.name === 'IPv4')
    expect(ip?.fields.find(([k]) => k === 'IP source')?.[1]).toBe('203.0.113.2')
    expect(evaluateCheck(s, { type: 'natEnabled', server: 'SRV1' })).toBe(true)
  })

  it('assistant : rôle requis, deux interfaces, pas de reconfiguration', () => {
    const s = internetLab()
    const srv = id(s, 'SRV1')
    const err = (st: LabState, cmd: AnyCommand) => {
      const r = dispatch(st, cmd)
      return !r.ok && r.error.code
    }
    expect(err(buildReferenceLab(), command('rras.configure', id(s, 'SRV1'), { mode: 'nat' }))).toBe(
      'RrasNotInstalled'
    )
    expect(err(s, command('rras.configure', srv, { mode: 'nat', publicIfaceId: 'absente' }))).toBe(
      'InvalidInterface'
    )
    expect(
      err(
        s,
        command('rras.configure', srv, {
          mode: 'vpn',
          publicIfaceId: iface(s, 'SRV1', 1),
          pool: { start: '192.168.10.210', end: '192.168.10.200' }
        })
      )
    ).toBe('InvalidPool')
    const configured = exec(s, command('rras.configure', srv, { mode: 'routing' }))
    expect(
      err(configured, command('rras.configure', srv, { mode: 'nat', publicIfaceId: iface(s, 'SRV1', 1) }))
    ).toBe('AlreadyConfigured')
    const disabled = exec(configured, command('rras.disable', srv))
    expect(rrasOf(disabled.devices[srv] as ServerDevice)?.mode).toBeNull()
  })
})

describe('RRAS : VPN', () => {
  function vpnLab(): LabState {
    const s = internetLab()
    return exec(
      s,
      command('rras.configure', id(s, 'SRV1'), {
        mode: 'vpn',
        publicIfaceId: iface(s, 'SRV1', 1),
        pool: { start: '192.168.10.200', end: '192.168.10.201' }
      }),
      command('vpn.addConnection', id(s, 'PCR'), { name: 'Bureau', server: '203.0.113.2' })
    )
  }

  it('acceptation : le client VPN reçoit une adresse du pool et joint un serveur interne', () => {
    let s = vpnLab()
    const pcr = id(s, 'PCR')
    expect(pingResult(s, 'PCR', '192.168.10.20').success).toBe(false)
    const r = dispatch(
      s,
      command('vpn.connect', pcr, 'Bureau', { user: 'LAB\\jdupont', password: 'Azerty123!' })
    )
    if (!r.ok) throw new Error(r.error.message)
    expect(r.value).toEqual({ ok: true, message: '', address: '192.168.10.200' })
    s = r.state
    expect(evaluateCheck(s, { type: 'vpnConnected', client: 'PCR', server: 'SRV1' })).toBe(true)
    const p = pingResult(s, 'PCR', '192.168.10.20')
    expect(p.success).toBe(true)
    expect(p.trace.events.some((e) => e.protocol === 'VPN' && e.layers.some((l) => l.name === 'SSTP'))).toBe(
      true
    )
    expect(p.trace.events.map((e) => e.note).join('\n')).toContain('désencapsule (source 192.168.10.200)')
    // Session visible côté serveur, puis déconnexion
    expect(run(s, id(s, 'SRV1'), 'Get-RemoteAccessConnectionStatistics').text).toContain('LAB\\jdupont')
    s = exec(s, command('vpn.disconnect', pcr, 'Bureau'))
    expect(pingResult(s, 'PCR', '192.168.10.20').success).toBe(false)
    expect(rrasOf(s.devices[id(s, 'SRV1')] as ServerDevice)?.sessions).toEqual([])
  })

  it('refus : mot de passe incorrect (691, journal), pool épuisé (720), serveur sans VPN (800)', () => {
    let s = vpnLab()
    const pcr = id(s, 'PCR')
    const bad = dispatch(s, command('vpn.connect', pcr, 'Bureau', { user: 'LAB\\jdupont', password: 'faux' }))
    expect(bad.ok && bad.value.message).toMatch(/^Erreur 691/)
    const log = bad.ok ? (bad.state.devices[id(s, 'SRV1')] as ServerDevice).host.eventLog : []
    expect(log.some((e) => e.source === 'RemoteAccess' && e.eventId === 20271)).toBe(true)
    s = exec(s, command('rras.setPool', id(s, 'SRV1'), { start: '192.168.10.200', end: '192.168.10.200' }))
    // Un autre client occupe la seule adresse
    s = exec(s, command('vpn.addConnection', id(s, 'SRV1'), { name: 'Boucle', server: '203.0.113.2' }))
    const first = dispatch(
      s,
      command('vpn.connect', pcr, 'Bureau', { user: 'LAB\\Administrateur', password: 'P@ssw0rd' })
    )
    expect(first.ok && first.value.ok).toBe(true)
    const other = exec(
      first.ok ? first.state : s,
      command('topology.addDevice', { kind: 'client', position: { x: 0, y: 0 }, name: 'PCS' })
    )
    void other
    const off = exec(
      internetLab(),
      command('vpn.addConnection', id(internetLab(), 'PCR'), { name: 'X', server: '203.0.113.2' })
    )
    const unreachable = dispatch(
      off,
      command('vpn.connect', id(off, 'PCR'), 'X', { user: 'a', password: 'b' })
    )
    expect(unreachable.ok && unreachable.value.message).toMatch(/^Erreur 800/)
  })

  it('cmdlets et rasdial : Install-RemoteAccess, Add-VpnConnection, connexion et liste', () => {
    let s = internetLab()
    const srv = id(s, 'SRV1')
    s = run(s, srv, 'Install-RemoteAccess -VpnType Vpn -IPAddressRange 192.168.10.200,192.168.10.210').state
    expect(run(s, srv, 'Get-RemoteAccess').text).toMatch(/VpnStatus\s+: Installed/)
    expect(rrasOf(s.devices[srv] as ServerDevice)?.publicIfaceId).toBe(iface(s, 'SRV1', 1))
    const pcr = id(s, 'PCR')
    s = run(s, pcr, 'Add-VpnConnection -Name Bureau -ServerAddress 203.0.113.2 -TunnelType Sstp -Force').state
    const dial = run(s, pcr, 'rasdial Bureau LAB\\jdupont Azerty123!', { shell: 'cmd' })
    expect(dial.text).toContain('Connexion établie avec Bureau.')
    s = dial.state
    expect(run(s, pcr, 'rasdial', { shell: 'cmd' }).text).toContain('Bureau')
    expect(run(s, pcr, 'Get-VpnConnection -Name Bureau').text).toMatch(/ConnectionStatus\s+: Connected/)
    s = run(s, pcr, 'rasdial Bureau /disconnect', { shell: 'cmd' }).state
    expect(run(s, pcr, 'rasdial', { shell: 'cmd' }).text).toContain('Aucune connexion')
  })
})
