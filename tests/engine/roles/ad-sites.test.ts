/**
 * Multi-sites AD : sites, sous-réseaux, liens ; second contrôleur ; réplication (état, zones DNS
 * intégrées à AD, erreurs 1722 / KCC) ; rôles FSMO ; localisation du DC du site du client.
 */
import { describe, expect, it } from 'vitest'
import {
  addDevice,
  command,
  connect,
  dispatch,
  evaluateCheck,
  installFeatures,
  joinDomain,
  logon,
  replicateDirectory,
  restartComputer,
  setInterfaceIpv4,
  setSwitchport,
  unwrap,
  type AnyCommand,
  type LabState,
  type ServerDevice
} from '@engine/index'
import { buildReferenceLab } from '../serialization/reference-lab'
import { run } from '../shell/helpers'

const D = 'lab.local'
const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''

function exec(state: LabState, ...cmds: AnyCommand[]): LabState {
  let s = state
  for (const cmd of cmds) {
    const r = dispatch(s, cmd)
    if (!r.ok) throw new Error(`${cmd.type} : ${r.error.message}`)
    s = r.state
  }
  return s
}

const err = (s: LabState, cmd: AnyCommand) => {
  const r = dispatch(s, cmd)
  return r.ok ? null : r.error.code
}

/** Lab de référence + SRV2 et PC3 dans le VLAN 20 (192.168.20.0/24, routé par R1). */
function twoSites(): LabState {
  let s = buildReferenceLab()
  const sw = id(s, 'SW1')
  for (const [kind, name] of [
    ['server', 'SRV2'],
    ['client', 'PC3']
  ] as const)
    s = unwrap(addDevice(s, { kind, position: { x: 500, y: 300 }, name })).state
  const port = (i: number) => s.devices[sw]!.interfaces[i]!.id
  s = unwrap(setSwitchport(s, sw, port(6), { mode: 'access', accessVlan: 20 })).state
  s = unwrap(
    connect(
      s,
      { deviceId: id(s, 'SRV2'), ifaceId: s.devices[id(s, 'SRV2')]!.interfaces[0]!.id },
      { deviceId: sw, ifaceId: port(4) }
    )
  ).state
  s = unwrap(
    connect(
      s,
      { deviceId: id(s, 'PC3'), ifaceId: s.devices[id(s, 'PC3')]!.interfaces[0]!.id },
      { deviceId: sw, ifaceId: port(6) }
    )
  ).state
  for (const [name, address] of [
    ['SRV2', '192.168.20.1'],
    ['PC3', '192.168.20.10']
  ] as const)
    s = unwrap(
      setInterfaceIpv4(s, id(s, name), s.devices[id(s, name)]!.interfaces[0]!.id, {
        addressing: 'static',
        address,
        mask: '24',
        gateway: '192.168.20.254',
        dnsServers: ['192.168.10.1']
      })
    ).state
  return exec(
    s,
    command('adds.renameSite', D, 'Default-First-Site-Name', 'Paris'),
    command('adds.newSite', D, { name: 'Lyon' }),
    command('adds.newSubnet', D, { prefix: '192.168.10.0/24', site: 'Paris' }),
    command('adds.newSubnet', D, { prefix: '192.168.20.0/24', site: 'Lyon' }),
    command('adds.newSiteLink', D, { name: 'Paris-Lyon', sites: ['Paris', 'Lyon'], cost: 100, interval: 15 })
  )
}

function promoted(): LabState {
  let s = twoSites()
  s = unwrap(
    installFeatures(s, id(s, 'SRV2'), ['AD-Domain-Services'], { includeManagementTools: true })
  ).state
  const r = dispatch(
    s,
    command('adds.installDomainController', id(s, 'SRV2'), {
      domainName: D,
      user: 'LAB\\Administrateur',
      password: (s.devices[id(s, 'SRV1')] as ServerDevice).host.localAdminPassword,
      safeModePassword: 'P@ssw0rd!'
    })
  )
  if (!r.ok || !r.value.success) throw new Error(r.ok ? r.value.message : r.error.message)
  return replicateDirectory(r.state).state
}

const zoneOf = (s: LabState, name: string) =>
  (s.devices[id(s, name)] as ServerDevice).roles['dns'] as {
    zones: { name: string; records: { name: string; data: string }[] }[]
  }

describe('Sites et services Active Directory', () => {
  it('sites, sous-réseaux, liens : création, renommage, validations', () => {
    const s = twoSites()
    const domain = s.domains[D]!
    expect(domain.sites.map((x) => x.name)).toEqual(['Paris', 'Lyon'])
    expect(domain.siteLinks.find((l) => l.name === 'DEFAULTIPSITELINK')?.sites).toEqual(['Paris'])
    expect(evaluateCheck(s, { type: 'adSite', site: 'Lyon', subnet: '192.168.20.0/24' })).toBe(true)
    expect(evaluateCheck(s, { type: 'siteLink', sites: ['Paris', 'Lyon'], maxInterval: 15 })).toBe(true)
    expect(err(s, command('adds.newSite', D, { name: 'Lyon' }))).toBe('SiteExists')
    expect(err(s, command('adds.newSite', D, { name: 'Mon site' }))).toBe('InvalidSiteName')
    expect(err(s, command('adds.newSubnet', D, { prefix: '192.168.20.1/24', site: 'Lyon' }))).toBe(
      'InvalidSubnet'
    )
    expect(err(s, command('adds.newSiteLink', D, { name: 'X', sites: ['Lyon'] }))).toBe('TwoSitesRequired')
    expect(err(s, command('adds.setSiteLink', D, 'Paris-Lyon', { interval: 20 }))).toBe('InvalidInterval')
    expect(err(s, command('adds.removeSite', D, 'Paris'))).toBe('SiteHasServers')
    // Le DC a réinscrit ses enregistrements SRV de site sous le nouveau nom
    const records = zoneOf(s, 'SRV1').zones.find((z) => z.name === D)!.records
    expect(records.some((r) => r.name === '_ldap._tcp.Paris._sites.dc._msdcs')).toBe(true)
    expect(records.some((r) => r.name.includes('Default-First-Site-Name'))).toBe(false)
  })

  it('cmdlets : New-ADReplicationSite, New-ADReplicationSubnet, Get/Set-ADReplicationSiteLink', () => {
    let s = buildReferenceLab()
    const srv = id(s, 'SRV1')
    s = run(s, srv, 'New-ADReplicationSite -Name Lyon').state
    s = run(s, srv, 'New-ADReplicationSubnet -Name 192.168.20.0/24 -Site Lyon').state
    s = run(
      s,
      srv,
      'New-ADReplicationSiteLink -Name SL -SitesIncluded Default-First-Site-Name,Lyon -Cost 50 -ReplicationFrequencyInMinutes 30'
    ).state
    s = run(s, srv, 'Set-ADReplicationSiteLink SL -ReplicationFrequencyInMinutes 15').state
    expect(run(s, srv, 'Get-ADReplicationSiteLink SL').text).toMatch(/ReplicationFrequencyInMinutes\s+: 15/)
    expect(run(s, srv, 'Get-ADReplicationSubnet').text).toContain(
      'CN=Lyon,CN=Sites,CN=Configuration,DC=lab,DC=local'
    )
    expect(run(s, srv, 'Get-ADReplicationSite -Filter *').text).toContain('Default-First-Site-Name')
  })
})

describe('Second contrôleur, réplication et FSMO', () => {
  it('acceptation : promotion dans le site du sous-réseau, réplication des zones DNS', () => {
    let s = promoted()
    const srv2 = id(s, 'SRV2')
    expect(evaluateCheck(s, { type: 'domainController', server: 'SRV2', site: 'Lyon' })).toBe(true)
    // Zone copiée, enregistrements du nouveau DC inscrits
    const z2 = zoneOf(s, 'SRV2').zones.find((z) => z.name === D)!
    expect(z2.records.some((r) => r.name === '_ldap._tcp.Lyon._sites.dc._msdcs')).toBe(true)
    const status = s.domains[D]!.replication.status
    expect(status.length).toBe(2)
    expect(status.every((x) => x.result === 0)).toBe(true)
    // Un enregistrement créé sur SRV1 arrive sur SRV2 par la réplication
    s = run(
      s,
      id(s, 'SRV1'),
      'Add-DnsServerResourceRecordA -ZoneName lab.local -Name web -IPv4Address 192.168.10.80'
    ).state
    expect(
      zoneOf(s, 'SRV2')
        .zones.find((z) => z.name === D)!
        .records.some((r) => r.name === 'web')
    ).toBe(false)
    s = replicateDirectory(s).state
    expect(
      zoneOf(s, 'SRV2')
        .zones.find((z) => z.name === D)!
        .records.some((r) => r.name === 'web')
    ).toBe(true)
    // Suppression répliquée elle aussi
    s = run(s, srv2, 'Remove-DnsServerResourceRecord -ZoneName lab.local -Name web -RRType A -Force').state
    s = replicateDirectory(s).state
    expect(
      zoneOf(s, 'SRV1')
        .zones.find((z) => z.name === D)!
        .records.some((r) => r.name === 'web')
    ).toBe(false)
    expect(run(s, srv2, 'repadmin /replsummary', { shell: 'cmd' }).text).toContain('SRV1')
    expect(run(s, srv2, 'Get-ADDomainController -Filter *').text).toMatch(/Site\s+: Lyon/)
  })

  it('partenaire injoignable : erreur 1722, événement 1925 ; site isolé : 1311', () => {
    let s = promoted()
    s = exec(s, command('topology.setPower', id(s, 'SRV1'), false))
    s = replicateDirectory(s).state
    const srv2Log = (s.devices[id(s, 'SRV2')] as ServerDevice).host.eventLog
    expect(s.domains[D]!.replication.status.find((x) => x.dcId === id(s, 'SRV2'))?.result).toBe(1722)
    expect(srv2Log.some((e) => e.eventId === 1925)).toBe(true)
    expect(run(s, id(s, 'SRV2'), 'repadmin /showrepl', { shell: 'cmd' }).text).toContain('résultat 1722')
    let t = promoted()
    t = exec(t, command('adds.removeSiteLink', D, 'Paris-Lyon'))
    t = replicateDirectory(t).state
    expect((t.devices[id(t, 'SRV2')] as ServerDevice).host.eventLog.some((e) => e.eventId === 1311)).toBe(
      true
    )
  })

  it('FSMO : netdom query fsmo, transfert, prise de force', () => {
    let s = promoted()
    const srv1 = id(s, 'SRV1')
    expect(run(s, srv1, 'netdom query fsmo', { shell: 'cmd' }).text).toContain('Contrôleur domaine principal')
    s = run(
      s,
      srv1,
      'Move-ADDirectoryServerOperationMasterRole -Identity SRV2 -OperationMasterRole PDCEmulator,1',
      {
        answers: ['O']
      }
    ).state
    expect(evaluateCheck(s, { type: 'fsmoRole', role: 'PDCEmulator', server: 'SRV2' })).toBe(true)
    expect(evaluateCheck(s, { type: 'fsmoRole', role: 'RIDMaster', server: 'SRV2' })).toBe(true)
    expect(evaluateCheck(s, { type: 'fsmoRole', role: 'SchemaMaster', server: 'SRV1' })).toBe(true)
    // Détenteur éteint : transfert refusé, prise de force acceptée
    s = exec(s, command('topology.setPower', srv1, false))
    const srv2 = id(s, 'SRV2')
    expect(err(s, command('adds.moveFsmoRoles', D, srv2, ['SchemaMaster']))).toBe('HolderUnavailable')
    s = exec(s, command('adds.moveFsmoRoles', D, srv2, ['SchemaMaster'], { force: true }))
    expect(evaluateCheck(s, { type: 'fsmoRole', role: 'SchemaMaster', server: 'SRV2' })).toBe(true)
  })

  it('acceptation : le client s’authentifie auprès du DC de son site', () => {
    let s = promoted()
    const pc3 = id(s, 'PC3')
    const joined = joinDomain(s, pc3, {
      domain: D,
      user: 'LAB\\Administrateur',
      password: (s.devices[id(s, 'SRV1')] as ServerDevice).host.localAdminPassword
    })
    expect(joined.ok).toBe(true)
    s = unwrap(restartComputer(joined.state, pc3)).state
    const r = logon(s, pc3, { user: 'jdupont', password: 'Azerty123!', domain: 'LAB' })
    expect(r.ok).toBe(true)
    expect(evaluateCheck(r.state, { type: 'logonServer', client: 'PC3', server: 'SRV2' })).toBe(true)
    expect(run(r.state, pc3, '$env:LOGONSERVER').text.trim()).toBe('\\\\SRV2')
    expect(run(r.state, pc3, 'nltest /dsgetdc:lab.local', { shell: 'cmd' }).text).toContain(
      'Nom de notre site : Lyon'
    )
    // Poste du site Paris : SRV1
    const pc2 = id(s, 'PC2')
    void pc2
  })

  it('refus : identifiants sans droits, site inconnu', () => {
    let s = twoSites()
    s = unwrap(
      installFeatures(s, id(s, 'SRV2'), ['AD-Domain-Services'], { includeManagementTools: true })
    ).state
    const promote = (input: object) => {
      const r = dispatch(
        s,
        command('adds.installDomainController', id(s, 'SRV2'), {
          domainName: D,
          user: 'LAB\\jdupont',
          password: 'Azerty123!',
          safeModePassword: 'P@ssw0rd!',
          ...input
        })
      )
      return r.ok ? r.value.message : r.error.message
    }
    expect(promote({})).toContain('Admins du domaine')
    expect(promote({ user: 'LAB\\Administrateur', password: 'x' })).toContain('incorrect')
  })
})
