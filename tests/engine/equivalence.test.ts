/**
 * Équivalence GUI ⇔ PowerShell ⇔ CMD : une même action administrative, faite depuis la console
 * graphique (commandes nommées de l'interface), PowerShell ou l'Invite de commandes, aboutit au
 * même état. Comparaison sur une projection lisible (noms, chemins, droits) : identifiants,
 * horodatages et journaux d'évènements diffèrent légitimement d'un chemin à l'autre.
 */
import { describe, expect, it } from 'vitest'
import {
  command,
  dhcpServerOf,
  dispatch,
  dnsServerOf,
  domainToken,
  nodePath,
  type AnyCommand,
  type Domain,
  type LabState,
  type ServerDevice
} from '@engine/index'
import { buildReferenceLab } from './serialization/reference-lab'
import { run } from './shell/helpers'

const D = 'lab.local'
const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''
const server = (s: LabState) => s.devices[id(s, 'SRV1')] as ServerDevice

/** Exécute des commandes de l'interface (dispatch) ; toute erreur fait échouer le test. */
function gui(state: LabState, build: (s: LabState) => AnyCommand[]): LabState {
  let s = state
  for (const cmd of build(s)) {
    const r = dispatch(s, cmd)
    if (!r.ok) throw new Error(`${cmd.type} : ${r.error.message}`)
    s = r.state
  }
  return s
}

/** Exécute des lignes de console sur SRV1 ; toute erreur affichée fait échouer le test. */
function shell(state: LabState, shellKind: 'powershell' | 'cmd', lines: string[]): LabState {
  let s = state
  for (const line of lines) {
    const r = run(s, id(s, 'SRV1'), line, { shell: shellKind, answers: ['O'] })
    if (r.errors) throw new Error(`${line}\n${r.errors}`)
    s = r.state
  }
  return s
}

/** Nom distinctif d'un conteneur (OU=Ventes,DC=lab,DC=local). */
function dn(domain: Domain, containerId: string | null): string {
  const parts: string[] = []
  let current = domain.containers.find((c) => c.id === containerId)
  while (current) {
    parts.push(`${current.kind === 'ou' ? 'OU' : 'CN'}=${current.name}`)
    const parentId = current.parentId
    current = domain.containers.find((c) => c.id === parentId)
  }
  return [...parts, ...domain.name.split('.').map((p) => `DC=${p}`)].join(',')
}

function adProjection(s: LabState) {
  const domain = s.domains[D]!
  const nameOf = (objectId: string) =>
    [...domain.users, ...domain.groups, ...domain.computers].find((o) => o.id === objectId)?.name ?? objectId
  return {
    ous: domain.containers.map((c) => ({ dn: dn(domain, c.id), protected: c.protected })),
    users: domain.users.map((u) => ({
      name: u.name,
      sam: u.sam,
      upn: u.upn,
      enabled: u.enabled,
      parent: dn(domain, u.parentId),
      mustChangePassword: u.mustChangePassword
    })),
    groups: domain.groups.map((g) => ({
      name: g.name,
      scope: g.scope,
      category: g.category,
      parent: dn(domain, g.parentId),
      members: g.members.map(nameOf).sort()
    }))
  }
}

function gpoProjection(s: LabState) {
  const domain = s.domains[D]!
  const links = (gpoId: string) => [
    ...domain.gpLinks.filter((l) => l.gpoId === gpoId).map((l) => ({ ...l, gpoId: undefined, target: D })),
    ...domain.containers.flatMap((c) =>
      c.gpLinks
        .filter((l) => l.gpoId === gpoId)
        .map((l) => ({ ...l, gpoId: undefined, target: dn(domain, c.id) }))
    )
  ]
  return domain.gpos.map((g) => ({
    name: g.name,
    status: g.status,
    computer: g.computer,
    user: g.user,
    links: links(g.id)
  }))
}

function filesProjection(s: LabState) {
  const storage = server(s).storage
  return {
    nodes: storage.nodes.map((n) => ({
      path: nodePath(storage, n.id),
      kind: n.kind,
      inherits: n.inherits,
      acl: n.acl
    })),
    shares: storage.shares.map((sh) => ({
      name: sh.name,
      path: nodePath(storage, sh.folderId),
      acl: sh.acl,
      description: sh.description
    }))
  }
}

describe('équivalence GUI ⇔ PowerShell ⇔ CMD', () => {
  it('AD DS : unité d’organisation, utilisateur, groupe et appartenance', () => {
    const ventes = 'OU=Ventes,DC=lab,DC=local'
    const viaGui = gui(buildReferenceLab(), () => [
      command('adds.addOrganizationalUnit', D, {
        name: 'Ventes',
        path: 'DC=lab,DC=local',
        protectedFromDeletion: true
      }),
      command('adds.addUser', D, {
        name: 'Paul Durand',
        sam: 'pdurand',
        upn: 'pdurand@lab.local',
        path: ventes,
        password: 'Azerty123!',
        enabled: true
      }),
      command('adds.addGroup', D, { name: 'GG_Ventes', scope: 'Global', category: 'Security', path: ventes }),
      command('adds.addGroupMembers', D, `CN=GG_Ventes,${ventes}`, [`CN=Paul Durand,${ventes}`])
    ])
    const viaPs = shell(buildReferenceLab(), 'powershell', [
      'New-ADOrganizationalUnit -Name Ventes -ProtectedFromAccidentalDeletion $true',
      "New-ADUser -Name 'Paul Durand' -SamAccountName pdurand -UserPrincipalName pdurand@lab.local -Path 'OU=Ventes,DC=lab,DC=local' -AccountPassword (ConvertTo-SecureString 'Azerty123!' -AsPlainText -Force) -Enabled $true",
      "New-ADGroup -Name GG_Ventes -GroupScope Global -GroupCategory Security -Path 'OU=Ventes,DC=lab,DC=local'",
      'Add-ADGroupMember -Identity GG_Ventes -Members pdurand'
    ])
    expect(adProjection(viaGui).groups.find((g) => g.name === 'GG_Ventes')?.members).toEqual(['Paul Durand'])
    expect(adProjection(viaPs)).toEqual(adProjection(viaGui))
  })

  it('DHCP : étendue et options d’étendue', () => {
    const srv = (s: LabState) => id(s, 'SRV1')
    const viaGui = gui(buildReferenceLab(), (s) => [
      command(
        'dhcp.createScope',
        srv(s),
        { name: 'Etage2', start: '192.168.20.100', end: '192.168.20.200', mask: '255.255.255.0' },
        { router: ['192.168.20.254'], dnsServers: ['192.168.10.1'], dnsDomain: 'lab.local' }
      )
    ])
    const viaPs = shell(buildReferenceLab(), 'powershell', [
      'Add-DhcpServerv4Scope -Name Etage2 -StartRange 192.168.20.100 -EndRange 192.168.20.200 -SubnetMask 255.255.255.0',
      'Set-DhcpServerv4OptionValue -ScopeId 192.168.20.0 -Router 192.168.20.254 -DnsServer 192.168.10.1 -DnsDomain lab.local'
    ])
    expect(dhcpServerOf(server(viaGui))?.scopes.map((x) => x.name)).toEqual(['LAN', 'Etage2'])
    expect(dhcpServerOf(server(viaPs))?.scopes).toEqual(dhcpServerOf(server(viaGui))?.scopes)
  })

  it('DNS : zone principale et enregistrement A', () => {
    const viaGui = gui(buildReferenceLab(), (s) => [
      command('dns.addPrimaryZone', id(s, 'SRV1'), {
        name: 'test.local',
        adIntegrated: false,
        dynamicUpdate: 'None'
      }),
      command('dns.addRecord', id(s, 'SRV1'), 'test.local', { name: 'www', type: 'A', data: '192.168.10.50' })
    ])
    const viaPs = shell(buildReferenceLab(), 'powershell', [
      'Add-DnsServerPrimaryZone -Name test.local -ZoneFile test.local.dns',
      'Add-DnsServerResourceRecordA -ZoneName test.local -Name www -IPv4Address 192.168.10.50'
    ])
    const zone = (s: LabState) => dnsServerOf(server(s))?.zones.find((z) => z.name === 'test.local')
    expect(zone(viaGui)?.records.some((r) => r.name === 'www' && r.data === '192.168.10.50')).toBe(true)
    expect(zone(viaPs)).toEqual(zone(viaGui))
  })

  it('GPO : création et liaison à une unité d’organisation', () => {
    const viaGui = gui(buildReferenceLab(), (s) => {
      const ou = s.domains[D]!.containers.find((c) => c.name === 'Compta')!
      return [command('gpo.createAndLink', D, { name: 'Postes Compta' }, ou.id)]
    })
    const viaPs = shell(buildReferenceLab(), 'powershell', [
      "New-GPO -Name 'Postes Compta'",
      "New-GPLink -Name 'Postes Compta' -Target 'OU=Compta,DC=lab,DC=local'"
    ])
    expect(gpoProjection(viaGui).find((g) => g.name === 'Postes Compta')?.links).toHaveLength(1)
    expect(gpoProjection(viaPs)).toEqual(gpoProjection(viaGui))
  })

  it('Fichiers : dossier partagé, autorisations de partage et NTFS (GUI, PowerShell, cmd)', () => {
    const viaGui = gui(buildReferenceLab(), (s) => {
      const domain = s.domains[D]!
      const token = domainToken(domain, 'Administrateur')!
      const gg = domain.groups.find((g) => g.name === 'GG_Compta')!.id
      return [
        command('files.createItem', id(s, 'SRV1'), 'C:\\Compta', 'folder', token, {}),
        command(
          'files.createShare',
          id(s, 'SRV1'),
          { name: 'Compta', path: 'C:\\Compta', change: ['LAB\\GG_Compta'] },
          token
        ),
        command('files.setNtfsEntry', id(s, 'SRV1'), 'C:\\Compta', gg, { allow: ['Modify'], deny: [] }, token)
      ]
    })
    const viaPs = shell(buildReferenceLab(), 'powershell', [
      'New-Item -Path C:\\Compta -ItemType Directory',
      'New-SmbShare -Name Compta -Path C:\\Compta -ChangeAccess LAB\\GG_Compta',
      // Comme sous Windows : sans guillemets, PowerShell évaluerait (OI) comme une commande
      "icacls C:\\Compta /grant 'LAB\\GG_Compta:(OI)(CI)M'"
    ])
    const viaCmd = shell(buildReferenceLab(), 'cmd', [
      'md C:\\Compta',
      'net share Compta=C:\\Compta /grant:LAB\\GG_Compta,CHANGE',
      'icacls C:\\Compta /grant LAB\\GG_Compta:(OI)(CI)M'
    ])
    expect(filesProjection(viaGui).shares.map((x) => x.name)).toEqual(['Compta'])
    expect(filesProjection(viaPs)).toEqual(filesProjection(viaGui))
    expect(filesProjection(viaCmd)).toEqual(filesProjection(viaGui))
  })
})
