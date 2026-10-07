/**
 * Serveur NPS (RADIUS) : clients RADIUS, stratégies réseau par groupe du domaine, décision
 * d'accès des clients VPN d'un serveur RRAS, journal (6272 / 6273, 13, 18), cmdlets.
 */
import { describe, expect, it } from 'vitest'
import {
  addDevice,
  addGroup,
  addGroupMembers,
  addUser,
  command,
  connect,
  dispatch,
  evaluateCheck,
  installFeatures,
  npsOf,
  setInterfaceIpv4,
  unwrap,
  vpnConnect,
  type AnyCommand,
  type DeviceKind,
  type LabState,
  type ServerDevice
} from '@engine/index'
import { buildReferenceLab } from '../serialization/reference-lab'
import { run } from '../shell/helpers'

const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''
const iface = (s: LabState, name: string, index: number) => s.devices[id(s, name)]!.interfaces[index]!.id
const server = (s: LabState, name: string) => s.devices[id(s, name)] as ServerDevice
const events = (s: LabState, name: string) => server(s, name).host.eventLog

function exec(state: LabState, ...cmds: AnyCommand[]): LabState {
  let s = state
  for (const cmd of cmds) {
    const r = dispatch(s, cmd)
    if (!r.ok) throw new Error(`${cmd.type} : ${r.error.message}`)
    s = r.state
  }
  return s
}

const error = (s: LabState, cmd: AnyCommand) => {
  const r = dispatch(s, cmd)
  return r.ok ? null : r.error.code
}

function staticIp(s: LabState, name: string, index: number, address: string, gateway: string | null) {
  return unwrap(
    setInterfaceIpv4(s, id(s, name), iface(s, name, index), {
      addressing: 'static',
      address,
      mask: '24',
      gateway,
      dnsServers: ['192.168.10.1']
    })
  ).state
}

/**
 * Lab de référence (SRV1 contrôleur de lab.local) + serveur VPN SRV2 (192.168.10.2 côté LAN,
 * 203.0.113.2 côté Internet) + poste distant PCR (203.0.113.50). jdupont est membre de GG_VPN,
 * mmartin non. SRV1 porte le rôle NPS.
 */
function radiusLab(): LabState {
  let s = buildReferenceLab()
  const add = (kind: DeviceKind, name: string) => {
    s = unwrap(addDevice(s, { kind, position: { x: 600, y: 0 }, name })).state
  }
  add('server', 'SRV2')
  add('cloud', 'INTERNET')
  add('switch', 'SWX')
  add('client', 'PCR')
  s = exec(s, command('topology.addServerInterface', id(s, 'SRV2')))
  const link = (a: string, ia: number, b: string, ib: number) => {
    s = unwrap(
      connect(
        s,
        { deviceId: id(s, a), ifaceId: iface(s, a, ia) },
        { deviceId: id(s, b), ifaceId: iface(s, b, ib) }
      )
    ).state
  }
  link('SRV2', 0, 'SW1', 5)
  link('INTERNET', 0, 'SWX', 0)
  link('SRV2', 1, 'SWX', 1)
  link('PCR', 0, 'SWX', 2)
  s = staticIp(s, 'SRV2', 0, '192.168.10.2', null)
  s = staticIp(s, 'SRV2', 1, '203.0.113.2', '203.0.113.1')
  s = staticIp(s, 'INTERNET', 0, '203.0.113.1', null)
  s = staticIp(s, 'PCR', 0, '203.0.113.50', '203.0.113.1')
  s = unwrap(
    addUser(s, 'lab.local', {
      name: 'Marie Martin',
      sam: 'mmartin',
      path: 'CN=Users,DC=lab,DC=local',
      upn: 'mmartin@lab.local',
      password: 'Azerty123!',
      enabled: true
    })
  ).state
  s = unwrap(
    addGroup(s, 'lab.local', { name: 'GG_VPN', scope: 'Global', path: 'CN=Users,DC=lab,DC=local' })
  ).state
  s = unwrap(addGroupMembers(s, 'lab.local', 'GG_VPN', ['jdupont'])).state
  s = unwrap(installFeatures(s, id(s, 'SRV1'), ['NPAS'], { includeManagementTools: true })).state
  s = unwrap(
    installFeatures(s, id(s, 'SRV2'), ['RemoteAccess', 'DirectAccess-VPN'], { includeManagementTools: true })
  ).state
  return exec(
    s,
    command('rras.configure', id(s, 'SRV2'), {
      mode: 'vpn',
      publicIfaceId: iface(s, 'SRV2', 1),
      pool: { start: '192.168.10.200', end: '192.168.10.210' }
    }),
    command('vpn.addConnection', id(s, 'PCR'), { name: 'Bureau', server: '203.0.113.2' })
  )
}

/** NPS configuré : client RADIUS SRV2, stratégie « VPN » accordée à GG_VPN ; SRV2 en RADIUS. */
function configured(): LabState {
  const s = radiusLab()
  return exec(
    s,
    command('nps.addClient', id(s, 'SRV1'), {
      name: 'SRV2-VPN',
      address: '192.168.10.2',
      sharedSecret: 'S3cret!'
    }),
    command('nps.addPolicy', id(s, 'SRV1'), { name: 'VPN', groups: ['LAB\\GG_VPN'], access: 'Grant' }),
    command('rras.addRadius', id(s, 'SRV2'), { server: '192.168.10.1', sharedSecret: 'S3cret!' })
  )
}

const vpn = (s: LabState, user: string, password = 'Azerty123!') => {
  const r = dispatch(s, command('vpn.connect', id(s, 'PCR'), 'Bureau', { user, password }))
  if (!r.ok) throw new Error(r.error.message)
  return { state: r.state, ...r.value }
}

describe('NPS : stratégies réseau', () => {
  it('rôle créé avec les deux stratégies de refus ; nouvelle stratégie en tête de l’ordre', () => {
    const s = configured()
    const nps = npsOf(server(s, 'SRV1'))
    expect(nps?.policies.map((p) => [p.name, p.access])).toEqual([
      ['VPN', 'Grant'],
      ['Connexions au serveur Microsoft de routage et d’accès à distance', 'Deny'],
      ['Connexions à d’autres serveurs d’accès', 'Deny']
    ])
    expect(nps?.radiusClients).toEqual([
      { name: 'SRV2-VPN', address: '192.168.10.2', sharedSecret: 'S3cret!' }
    ])
    expect(evaluateCheck(s, { type: 'radiusClient', server: 'SRV1', address: '192.168.10.2' })).toBe(true)
    expect(
      evaluateCheck(s, { type: 'npsPolicy', server: 'SRV1', group: 'LAB\\GG_VPN', access: 'Grant' })
    ).toBe(true)
    expect(evaluateCheck(s, { type: 'npsAccess', server: 'SRV1', user: 'LAB\\jdupont', granted: true })).toBe(
      true
    )
    expect(
      evaluateCheck(s, { type: 'npsAccess', server: 'SRV1', user: 'LAB\\mmartin', granted: false })
    ).toBe(true)
  })

  it('validations : rôle requis, domaine requis, groupe connu, noms uniques, secret, adresse', () => {
    const s = radiusLab()
    const srv1 = id(s, 'SRV1')
    expect(
      error(s, command('nps.addClient', id(s, 'SRV2'), { name: 'x', address: '1.2.3.4', sharedSecret: 's' }))
    ).toBe('NpsNotInstalled')
    expect(error(s, command('nps.addClient', srv1, { name: 'x', address: 'srv2', sharedSecret: 's' }))).toBe(
      'InvalidAddress'
    )
    expect(
      error(s, command('nps.addClient', srv1, { name: 'x', address: '192.168.10.2', sharedSecret: '' }))
    ).toBe('InvalidSecret')
    expect(
      error(s, command('nps.addPolicy', srv1, { name: 'VPN', groups: ['LAB\\Inconnu'], access: 'Grant' }))
    ).toBe('GroupNotFound')
    expect(error(s, command('nps.addPolicy', srv1, { name: 'VPN', groups: [], access: 'Grant' }))).toBe(
      'ConditionRequired'
    )
    expect(
      error(
        s,
        command('nps.addPolicy', srv1, {
          name: 'Connexions à d’autres serveurs d’accès',
          groups: ['GG_VPN'],
          access: 'Grant'
        })
      )
    ).toBe('PolicyExists')
    // Serveur NPS hors domaine : pas de condition « Groupes Windows »
    const standalone = unwrap(
      installFeatures(s, id(s, 'SRV2'), ['NPAS'], { includeManagementTools: true })
    ).state
    expect(
      error(
        standalone,
        command('nps.addPolicy', id(s, 'SRV2'), { name: 'VPN', groups: ['GG_VPN'], access: 'Grant' })
      )
    ).toBe('NotDomainMember')
  })

  it('ordre de traitement : la première stratégie correspondante s’applique', () => {
    let s = configured()
    const srv1 = id(s, 'SRV1')
    // La stratégie de refus remontée en tête s'applique avant « VPN »
    s = exec(s, command('nps.movePolicy', srv1, 'VPN', 1))
    expect(evaluateCheck(s, { type: 'npsAccess', server: 'SRV1', user: 'jdupont', granted: false })).toBe(
      true
    )
    expect(
      error(
        s,
        command(
          'nps.movePolicy',
          srv1,
          'Connexions au serveur Microsoft de routage et d’accès à distance',
          -1
        )
      )
    ).toBe('CannotMove')
    s = exec(s, command('nps.movePolicy', srv1, 'VPN', -1))
    expect(evaluateCheck(s, { type: 'npsAccess', server: 'SRV1', user: 'jdupont', granted: true })).toBe(true)
    // Désactivée, la stratégie n'est plus évaluée
    s = exec(s, command('nps.setPolicyEnabled', srv1, 'VPN', false))
    expect(evaluateCheck(s, { type: 'npsAccess', server: 'SRV1', user: 'jdupont', granted: true })).toBe(
      false
    )
    s = exec(s, command('nps.removePolicy', srv1, 'VPN'))
    expect(npsOf(server(s, 'SRV1'))?.policies).toHaveLength(2)
  })
})

describe('NPS : authentification RADIUS des clients VPN', () => {
  it('acceptation : seul le membre du groupe autorisé établit le VPN (journal 6272 / 6273)', () => {
    const s = configured()
    const ok = vpn(s, 'LAB\\jdupont')
    expect(ok.ok).toBe(true)
    expect(ok.address).toBe('192.168.10.200')
    expect(evaluateCheck(ok.state, { type: 'vpnConnected', client: 'PCR', server: 'SRV2' })).toBe(true)
    const granted = events(ok.state, 'SRV1').find((e) => e.eventId === 6272)
    expect(granted?.log).toBe('Sécurité')
    expect(granted?.message).toContain('Utilisateur : LAB\\jdupont')
    expect(granted?.message).toContain('Stratégie réseau : VPN')

    const denied = vpn(s, 'LAB\\mmartin')
    expect(denied.ok).toBe(false)
    expect(denied.message).toMatch(/^Erreur 691/)
    const refusal = events(denied.state, 'SRV1').find((e) => e.eventId === 6273)
    expect(refusal?.message).toContain('Code de raison : 65')
    expect(refusal?.message).toContain('Connexions au serveur Microsoft de routage et d’accès à distance')
    expect(events(denied.state, 'SRV2').some((e) => e.eventId === 20271)).toBe(true)

    // Mauvais mot de passe : raison 16 ; aucune stratégie correspondante : raison 48
    const bad = vpn(s, 'LAB\\jdupont', 'faux')
    expect(events(bad.state, 'SRV1').find((e) => e.eventId === 6273)?.message).toContain(
      'Code de raison : 16'
    )
    let none = s
    for (const name of [
      'Connexions au serveur Microsoft de routage et d’accès à distance',
      'Connexions à d’autres serveurs d’accès'
    ])
      none = exec(none, command('nps.removePolicy', id(s, 'SRV1'), name))
    const unmatched = vpn(none, 'LAB\\mmartin')
    expect(events(unmatched.state, 'SRV1').find((e) => e.eventId === 6273)?.message).toContain(
      'Code de raison : 48'
    )
  })

  it('échange tracé : Access-Request puis Access-Accept en UDP 1812', () => {
    const s = configured()
    const r = vpnConnect(s, id(s, 'PCR'), 'Bureau', { user: 'LAB\\jdupont', password: 'Azerty123!' })
    expect(r.ok).toBe(true)
    const radius = r.trace.events.filter((e) => e.protocol === 'RADIUS')
    expect(radius.map((e) => [e.fromDeviceId, e.toDeviceId, e.summary])).toEqual([
      [id(s, 'SRV2'), id(s, 'SW1'), 'RADIUS Access-Request (LAB\\jdupont)'],
      [id(s, 'SW1'), id(s, 'SRV1'), 'RADIUS Access-Request (LAB\\jdupont)'],
      [id(s, 'SRV1'), id(s, 'SW1'), 'RADIUS Access-Accept'],
      [id(s, 'SW1'), id(s, 'SRV2'), 'RADIUS Access-Accept']
    ])
    const udp = radius[0]?.layers.find((l) => l.name === 'UDP')
    expect(udp?.fields).toContainEqual(['Port destination', '1812'])
    // Le pare-feu du serveur NPS bloque RADIUS si la règle prédéfinie est désactivée
    const blocked = exec(
      s,
      command('firewall.setRuleEnabled', id(s, 'SRV1'), { name: 'NPS-NPSSvc-In-UDP-1812-1645' }, false)
    )
    expect(
      vpnConnect(blocked, id(s, 'PCR'), 'Bureau', { user: 'LAB\\jdupont', password: 'Azerty123!' }).ok
    ).toBe(false)
  })

  it('client RADIUS inconnu (13), secret différent (18) : pas de réponse, événement 20073', () => {
    const s = radiusLab()
    const srv2 = id(s, 'SRV2')
    let t = exec(s, command('rras.addRadius', srv2, { server: '192.168.10.1', sharedSecret: 'S3cret!' }))
    const unknown = vpn(t, 'LAB\\jdupont')
    expect(unknown.ok).toBe(false)
    expect(unknown.message).toContain('aucune réponse du serveur d’authentification RADIUS')
    expect(events(unknown.state, 'SRV1').some((e) => e.source === 'NPS' && e.eventId === 13)).toBe(true)
    expect(events(unknown.state, 'SRV2').some((e) => e.eventId === 20073)).toBe(true)
    t = exec(
      t,
      command('nps.addClient', id(s, 'SRV1'), {
        name: 'SRV2-VPN',
        address: '192.168.10.2',
        sharedSecret: 'autre'
      })
    )
    const secret = vpn(t, 'LAB\\jdupont')
    expect(secret.ok).toBe(false)
    expect(events(secret.state, 'SRV1').some((e) => e.source === 'NPS' && e.eventId === 18)).toBe(true)
    // Sans serveur RADIUS : retour à l'authentification Windows
    t = exec(t, command('rras.removeRadius', srv2, '192.168.10.1'))
    expect(vpn(t, 'SRV2\\Administrateur', server(t, 'SRV2').host.localAdminPassword).ok).toBe(true)
  })

  it('cmdlets : New/Get/Remove-NpsRadiusClient, Add/Get/Remove-RemoteAccessRadius', () => {
    let s = radiusLab()
    const srv1 = id(s, 'SRV1')
    const srv2 = id(s, 'SRV2')
    const created = run(
      s,
      srv1,
      'New-NpsRadiusClient -Name SRV2-VPN -Address 192.168.10.2 -SharedSecret S3cret!'
    )
    expect(created.text).toMatch(/Address\s+: 192\.168\.10\.2/)
    s = created.state
    expect(run(s, srv1, 'Get-NpsRadiusClient').text).toContain('SRV2-VPN')
    s = run(
      s,
      srv2,
      'Add-RemoteAccessRadius -ServerName 192.168.10.1 -SharedSecret S3cret! -Purpose Authentication'
    ).state
    expect(run(s, srv2, 'Get-RemoteAccessRadius').text).toContain('192.168.10.1')
    expect(
      run(s, srv2, 'Add-RemoteAccessRadius -ServerName 192.168.10.9 -SharedSecret x -Purpose Accounting').text
    ).toContain('Seuls les serveurs RADIUS d’authentification')
    s = run(s, srv2, 'Remove-RemoteAccessRadius -ServerName 192.168.10.1 -Purpose Authentication').state
    expect(run(s, srv2, 'Get-RemoteAccessRadius').text.trim()).toBe('')
    s = run(s, srv1, 'Remove-NpsRadiusClient -Name SRV2-VPN').state
    expect(npsOf(server(s, 'SRV1'))?.radiusClients).toEqual([])
  })
})
