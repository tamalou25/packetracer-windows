/**
 * Catalogue des commandes : chaque commande nommée (système de base et modules de rôles) est
 * exécutée par `dispatch` avec les arguments que lui passe l'interface, sur le lab de référence.
 * Pour chacune : succès, libellé français lisible (évalué sur l'état d'avant), entrée de journal
 * dont les patches inverses ramènent exactement à l'état d'avant, .slab rouvert identique. Un dernier test exige que toute
 * commande du catalogue soit couverte ici : une commande ajoutée sans test le fait échouer.
 */
import { describe, expect, it } from 'vitest'
import {
  applyStatePatches,
  batch,
  command,
  commandDefinitions,
  createShellSession,
  dhcpServerOf,
  dispatch,
  domainToken,
  localToken,
  parseSlab,
  serializeSlab,
  sessionToken,
  type AnyCommand,
  type AccessToken,
  type LabState
} from '@engine/index'
import { buildReferenceLab } from '../serialization/reference-lab'

const DOMAIN = 'lab.local'
const COMPTA = 'OU=Compta,DC=lab,DC=local'

/** Exécute les commandes une à une en vérifiant libellé, journal et inverse. */
class Runner {
  readonly covered = new Set<string>()
  constructor(public state: LabState) {}

  id(name: string): string {
    const found = Object.values(this.state.devices).find((d) => d.name === name)
    if (!found) throw new Error(`équipement ${name} absent`)
    return found.id
  }

  iface(name: string, index = 0): string {
    return this.state.devices[this.id(name)]?.interfaces[index]?.id ?? ''
  }

  /** Jeton de l'Administrateur du domaine (consoles du DC). */
  admin(): AccessToken {
    const domain = this.state.domains[DOMAIN]
    const token = domain ? domainToken(domain, 'Administrateur') : null
    if (!token) throw new Error('jeton administrateur absent')
    return token
  }

  run<T = unknown>(cmd: AnyCommand, expectChange = true): T {
    const before = this.state
    const r = dispatch(before, cmd)
    if (!r.ok) throw new Error(`${cmd.type} : ${r.error.message}`)
    this.covered.add(cmd.type)
    if (cmd.type === 'batch') for (const sub of cmd.args[0] as AnyCommand[]) this.covered.add(sub.type)
    if (expectChange) {
      expect(r.entry, `${cmd.type} : entrée de journal`).not.toBeNull()
      const entry = r.entry!
      expect(entry.label, `${cmd.type} : libellé`).toMatch(/^\S/)
      expect(entry.label, `${cmd.type} : libellé complet`).not.toMatch(/undefined|null|NaN|\[object/)
      expect(entry.label, `${cmd.type} : libellé lisible`).not.toBe(cmd.type)
      // Inverse calculé par immer : retour exact à l'état d'avant, puis à l'état d'après
      const undone = applyStatePatches(r.state, entry.inversePatches)
      expect(undone, `${cmd.type} : annuler`).toEqual(before)
      expect(applyStatePatches(undone, entry.patches), `${cmd.type} : rétablir`).toEqual(r.state)
      // Enregistrer puis rouvrir le .slab redonne exactement le même lab
      const reopened = parseSlab(
        serializeSlab(r.state, { savedAt: '2026-10-06T12:00:00.000Z', appVersion: '2.0.0' })
      )
      if (!reopened.ok) throw new Error(`${cmd.type} : réouverture impossible (${reopened.message})`)
      expect(reopened.doc.lab, `${cmd.type} : réouverture`).toEqual(r.state)
    }
    this.state = r.state
    return r.value as T
  }
}

function runner(): Runner {
  return new Runner(buildReferenceLab())
}

describe('catalogue des commandes', () => {
  const covered = new Set<string>()
  const done = (r: Runner) => r.covered.forEach((t) => covered.add(t))

  it('topologie : ajout, renommage, déplacements, alimentation, câbles, copie, suppression', () => {
    const r = runner()
    r.run(command('topology.addDevice', { kind: 'client', position: { x: 600, y: 0 } }))
    r.run(command('topology.renameDevice', r.id('PC3'), 'PC9'))
    r.run(command('topology.moveDevice', r.id('PC9'), { x: 650, y: 20 }))
    r.run(command('topology.moveDevices', [{ id: r.id('PC9'), position: { x: 700, y: 40 } }]))
    r.run(command('topology.setPower', r.id('PC9'), false))
    r.run(command('topology.setPower', r.id('PC9'), true))
    const linkId = r.run<string>(
      command(
        'topology.connect',
        { deviceId: r.id('PC9'), ifaceId: r.iface('PC9') },
        { deviceId: r.id('SW1'), ifaceId: r.iface('SW1', 6) }
      )
    )
    expect(r.state.links[linkId]).toBeDefined()
    r.run(command('topology.disconnect', linkId))
    r.run(command('topology.addServerInterface', r.id('SRV1')))
    const pc9 = r.state.devices[r.id('PC9')]!
    const copies = r.run<string[]>(
      command('topology.duplicateDevices', { devices: [pc9], links: [] }, { x: 40, y: 40 })
    )
    expect(copies).toHaveLength(1)
    r.run(command('topology.removeDevices', [...copies, r.id('PC9')]))
    expect(Object.values(r.state.devices).map((d) => d.name)).not.toContain('PC9')
    done(r)
  })

  it('réseau et système : carte, IPv4, routes, redémarrage, renommage, journal, fonctionnalités', () => {
    const r = runner()
    r.run(command('net.setInterfaceEnabled', r.id('PC2'), r.iface('PC2'), false))
    r.run(command('net.setInterfaceEnabled', r.id('PC2'), r.iface('PC2'), true))
    r.run(
      command('net.setInterfaceIpv4', r.id('PC2'), r.iface('PC2'), {
        addressing: 'static',
        address: '192.168.10.30',
        mask: '24',
        gateway: '192.168.10.254',
        dnsServers: ['192.168.10.1']
      })
    )
    r.run(
      command('net.addStaticRoute', r.id('R1'), { network: '10.0.0.0', mask: '8', nextHop: '192.168.10.1' })
    )
    r.run(command('net.removeStaticRoute', r.id('R1'), 0))
    // Le nouveau nom s'applique au redémarrage
    const pc2 = r.id('PC2')
    r.run(command('system.renameComputer', pc2, 'POSTE2'))
    r.run(command('system.restartComputer', pc2))
    expect(r.state.devices[pc2]?.name).toBe('POSTE2')
    r.run(command('system.clearEventLog', r.id('SRV1'), 'Système'))
    r.run(command('system.installFeatures', r.id('SRV1'), ['FS-FileServer']))
    r.run(command('system.uninstallFeatures', r.id('SRV1'), ['FS-FileServer']))
    done(r)
  })

  it('consoles, tâches de fond et lots', () => {
    const r = runner()
    const session = createShellSession(r.state, r.id('SRV1'), 'powershell')
    r.run(command('shell.exec', session, 'New-ADGroup -Name GG_Test -GroupScope Global', []))
    expect(r.state.domains[DOMAIN]?.groups.map((g) => g.name)).toContain('GG_Test')
    // Lab déjà stabilisé : un passage des tâches de fond ne change rien
    r.run(command('background.tick'), false)
    r.run(
      batch('Créer l’unité RH et son groupe', [
        command('adds.addOrganizationalUnit', DOMAIN, { name: 'RH' }),
        command('adds.addGroup', DOMAIN, { name: 'GG_RH', scope: 'Global', path: 'OU=RH,DC=lab,DC=local' })
      ])
    )
    done(r)
  })

  it('DHCP : client, post-installation, autorisation, étendues, exclusions, réservations, options', () => {
    const r = runner()
    const srv = r.id('SRV1')
    r.run(command('net.dhcpRelease', r.id('PC1'), r.iface('PC1')))
    r.run(command('net.dhcpRenew', r.id('PC1'), r.iface('PC1')))
    r.run(command('dhcp.completePostInstall', srv, { authorize: true }), false)
    r.run(command('dhcp.authorize', srv, false))
    r.run(command('dhcp.authorize', srv, true))
    const scope = dhcpServerOf(r.state.devices[srv]!)!.scopes[0]!.scopeId
    r.run(command('dhcp.setScopeState', srv, scope, false))
    r.run(command('dhcp.setScopeState', srv, scope, true))
    r.run(command('dhcp.addExclusion', srv, scope, '192.168.10.150', '192.168.10.160'))
    r.run(command('dhcp.removeExclusion', srv, scope, 0))
    r.run(
      command('dhcp.addReservation', srv, scope, {
        name: 'IMP1',
        ip: '192.168.10.180',
        mac: '00-15-5D-01-02-03'
      })
    )
    r.run(command('dhcp.removeReservation', srv, scope, '192.168.10.180'))
    r.run(command('dhcp.setOptions', srv, null, { dnsServers: ['192.168.10.1'] }))
    const other = r.run<string>(
      command('dhcp.addScope', srv, {
        name: 'Wifi',
        start: '172.16.0.10',
        end: '172.16.0.50',
        mask: '255.255.255.0'
      })
    )
    r.run(command('dhcp.removeScope', srv, other))
    r.run(
      command(
        'dhcp.createScope',
        srv,
        { name: 'Invités', start: '172.17.0.10', end: '172.17.0.50', mask: '255.255.255.0' },
        { router: ['172.17.0.1'] }
      )
    )
    done(r)
  })

  it('DNS : zones directe et inverse, enregistrements, redirecteurs', () => {
    const r = runner()
    const srv = r.id('SRV1')
    r.run(command('dns.addPrimaryZone', srv, { name: 'test.local', dynamicUpdate: 'None' }))
    r.run(command('dns.addPrimaryZone', srv, { networkId: '192.168.10.0/24' }))
    r.run(command('dns.addRecord', srv, 'test.local', { name: 'www', type: 'A', data: '192.168.10.50' }))
    r.run(command('dns.removeRecord', srv, 'test.local', 'www', 'A', '192.168.10.50'))
    r.run(command('dns.removeZone', srv, 'test.local'))
    r.run(command('dns.setForwarders', srv, ['8.8.8.8']))
    done(r)
  })

  it('AD DS : objets, comptes, jonction, sessions, nouvelle forêt', () => {
    const r = runner()
    r.run(command('adds.addOrganizationalUnit', DOMAIN, { name: 'Direction' }))
    r.run(
      command('adds.addUser', DOMAIN, {
        name: 'Paul Durand',
        sam: 'pdurand',
        path: COMPTA,
        password: 'Azerty123!',
        enabled: true
      })
    )
    r.run(command('adds.addGroup', DOMAIN, { name: 'GG_Direction', scope: 'Global' }))
    r.run(command('adds.addGroupMembers', DOMAIN, 'GG_Direction', ['pdurand']))
    r.run(command('adds.removeGroupMembers', DOMAIN, 'GG_Direction', ['pdurand']))
    const user = r.state.domains[DOMAIN]!.users.find((u) => u.sam === 'pdurand')!
    r.run(command('adds.moveObject', DOMAIN, user.id, 'OU=Direction,DC=lab,DC=local'))
    r.run(command('adds.setAccountEnabled', DOMAIN, 'pdurand', false))
    r.run(command('adds.setAccountEnabled', DOMAIN, 'pdurand', true))
    // Mot de passe à changer : la session aboutit après le changement imposé
    r.run(command('adds.resetPassword', DOMAIN, 'pdurand', 'Bienvenue123!', true))
    // Session refusée en attendant le changement : aucune modification de l'état
    const first = r.run<{ success: boolean; mustChangePassword: boolean }>(
      command('adds.logon', r.id('PC1'), { user: 'pdurand', password: 'Bienvenue123!', domain: 'LAB' }),
      false
    )
    expect(first.success).toBe(false)
    expect(first.mustChangePassword).toBe(true)
    const changed = r.run<{ success: boolean }>(
      command('adds.changePasswordAndLogon', r.id('PC1'), {
        user: 'pdurand',
        password: 'Bienvenue123!',
        newPassword: 'Nouveau456!',
        domain: 'LAB'
      })
    )
    expect(changed.success).toBe(true)
    r.run(command('adds.logoff', r.id('PC1')))
    r.run(command('adds.removeObject', DOMAIN, user.id, false))
    // Jonction puis retrait de PC2 (poste statique pointant vers le DC)
    const dc = r.state.devices[r.id('SRV1')]
    const password = dc?.kind === 'server' ? dc.host.localAdminPassword : ''
    const joined = r.run<{ success: boolean }>(
      command('adds.joinDomain', r.id('PC2'), { domain: DOMAIN, user: 'LAB\\Administrateur', password })
    )
    expect(joined.success).toBe(true)
    r.run(command('system.restartComputer', r.id('PC2')))
    const left = r.run<{ success: boolean }>(command('adds.leaveDomain', r.id('PC2')))
    expect(left.success).toBe(true)
    // Nouvelle forêt sur un second serveur
    r.run(command('topology.addDevice', { kind: 'server', position: { x: 0, y: 300 }, name: 'SRV2' }))
    r.run(
      command('net.setInterfaceIpv4', r.id('SRV2'), r.iface('SRV2'), {
        addressing: 'static',
        address: '192.168.10.2',
        mask: '24',
        gateway: null,
        dnsServers: ['127.0.0.1']
      })
    )
    r.run(command('system.installFeatures', r.id('SRV2'), ['AD-Domain-Services']))
    r.run(
      command('adds.installForest', r.id('SRV2'), {
        domainName: 'autre.local',
        safeModePassword: 'P@ssw0rd!'
      })
    )
    expect(r.state.domains['autre.local']).toBeDefined()
    done(r)
  })

  it('Fichiers : dossiers, partages, autorisations NTFS et de partage, lecteurs réseau', () => {
    const r = runner()
    const srv = r.id('SRV1')
    const token = r.admin()
    r.run(command('files.createItem', srv, 'C:\\Partages', 'folder', token, {}))
    r.run(command('files.createItem', srv, 'C:\\Partages\\lisezmoi.txt', 'file', token, {}))
    r.run(command('files.createShare', srv, { name: 'Partages', path: 'C:\\Partages' }, token))
    r.run(
      command(
        'files.setShareAcl',
        srv,
        'Partages',
        [{ principal: 'S-1-1-0', type: 'Allow', rights: 'Change' }],
        token
      )
    )
    r.run(
      command(
        'files.setNtfsEntry',
        srv,
        'C:\\Partages',
        'LAB\\GG_Compta',
        { allow: ['Modify'], deny: [] },
        token
      )
    )
    r.run(command('files.removeNtfs', srv, 'C:\\Partages', 'LAB\\GG_Compta', 'all', token))
    r.run(command('files.setNtfsInheritance', srv, 'C:\\Partages', 'convert', token))
    r.run(command('files.setNtfsInheritance', srv, 'C:\\Partages', 'enable', token))
    // Lecteur réseau depuis le poste joint, session jdupont
    r.run(command('adds.logon', r.id('PC1'), { user: 'jdupont', password: 'Azerty123!', domain: 'LAB' }))
    const user = sessionToken(r.state, r.id('PC1'))!
    r.run(command('files.mapDrive', r.id('PC1'), 'P', '\\\\SRV1\\Partages', user, { persistent: false }))
    r.run(command('files.unmapDrive', r.id('PC1'), 'P', user.account))
    r.run(command('files.removeShare', srv, 'Partages', token))
    r.run(command('files.removeItem', srv, 'C:\\Partages', token, { recurse: true }))
    r.run(
      command(
        'files.shareFolder',
        srv,
        { name: 'Commun', path: 'C:\\Commun' },
        localToken('SRV1', 'Administrateur')
      )
    )
    done(r)
  })

  it('GPO : création, liaison, état, héritage, filtrage, paramètres, suppression', () => {
    const r = runner()
    const ou = r.state.domains[DOMAIN]!.containers.find((c) => c.name === 'Compta')!
    const gpo = r.run<string>(command('gpo.create', DOMAIN, { name: 'Sécurité postes' }))
    r.run(command('gpo.rename', DOMAIN, gpo, 'Sécurité des postes'))
    r.run(command('gpo.setStatus', DOMAIN, gpo, 'UserSettingsDisabled'))
    r.run(command('gpo.link', DOMAIN, gpo, ou.id))
    r.run(command('gpo.updateLink', DOMAIN, gpo, ou.id, { enforced: true }))
    r.run(command('gpo.setInheritanceBlocked', DOMAIN, ou.id, true))
    r.run(command('gpo.setSecurityFilter', DOMAIN, gpo, 'GG_Compta', true))
    r.run(command('gpo.updateSettings', DOMAIN, gpo, { computer: { minPasswordLength: 10 } }))
    r.run(command('gpo.unlink', DOMAIN, gpo, ou.id))
    r.run(command('gpo.delete', DOMAIN, gpo))
    const linked = r.run<string>(command('gpo.createAndLink', DOMAIN, { name: 'Lecteurs' }, ou.id))
    expect(r.state.domains[DOMAIN]!.gpos.some((g) => g.id === linked)).toBe(true)
    done(r)
  })

  it('WSUS : post-installation, synchronisation, classifications, groupes, ciblage, approbations', () => {
    const r = runner()
    const srv = r.id('SRV1')
    r.run(command('system.installFeatures', srv, ['UpdateServices'], { includeManagementTools: true }))
    r.run(command('wsus.postInstall', srv, 'C:\\WSUS'))
    r.run(command('wsus.setClassification', srv, 'drivers', true))
    r.run(command('wsus.synchronize', srv))
    r.run(command('wsus.addGroup', srv, 'Postes'))
    r.run(command('wsus.assignComputer', srv, r.id('PC1'), 'Postes'))
    r.run(command('wsus.approve', srv, 'KB9100102', 'Postes', true))
    r.run(command('wsus.decline', srv, 'KB9100401', true))
    r.run(command('wsus.setTargeting', srv, 'client'))
    r.run(command('wsus.removeGroup', srv, 'Postes'))
    done(r)
  })

  it('IIS : sites, liaisons, certificat SSL, dossier racine, démarrage et arrêt', () => {
    const r = runner()
    const srv = r.id('SRV1')
    r.run(command('system.installFeatures', srv, ['Web-Server'], { includeManagementTools: true }))
    r.run(command('files.createItem', srv, 'C:\\Sites\\Intranet', 'folder', r.admin(), { parents: true }))
    r.run(
      command('iis.addSite', srv, {
        name: 'Intranet',
        physicalPath: 'C:\\inetpub\\wwwroot',
        binding: { host: 'intranet.lab.local' }
      })
    )
    r.run(command('iis.setPhysicalPath', srv, 'Intranet', 'C:\\Sites\\Intranet'))
    r.run(command('iis.addBinding', srv, 'Intranet', { protocol: 'https', host: 'intranet.lab.local' }))
    const thumb = r.run<string>(command('system.newSelfSignedCertificate', srv, ['intranet.lab.local']))
    r.run(
      command(
        'iis.setBindingCertificate',
        srv,
        'Intranet',
        { ip: '*', port: 443, host: 'intranet.lab.local' },
        thumb
      )
    )
    r.run(
      command('iis.removeBinding', srv, 'Intranet', {
        protocol: 'https',
        ip: '*',
        port: 443,
        host: 'intranet.lab.local'
      })
    )
    r.run(command('iis.setSiteState', srv, 'Intranet', false))
    r.run(command('iis.removeSite', srv, 'Intranet'))
    done(r)
  })

  it('Bureau à distance et RDS : paramètres, collection, RemoteApp, connexion, déconnexion', () => {
    const r = runner()
    const srv = r.id('SRV1')
    r.run(command('rds.setRemoteDesktop', srv, { enabled: true, users: ['GG_Compta'] }))
    r.run(command('system.installFeatures', srv, ['RDS-RD-Server'], { includeManagementTools: true }))
    r.run(command('rds.addCollection', srv, { name: 'Bureautique', userGroups: ['GG_Compta'] }))
    r.run(command('rds.setCollectionUserGroups', srv, 'Bureautique', ['GG_Compta', 'jdupont']))
    r.run(
      command('rds.addRemoteApp', srv, 'Bureautique', {
        displayName: 'Bloc-notes',
        filePath: 'C:\\Windows\\System32\\notepad.exe'
      })
    )
    const session = r.run<{ sessionId: number }>(
      command('rds.connect', r.id('PC1'), { computer: 'SRV1', user: 'LAB\\jdupont', password: 'Azerty123!' })
    )
    r.run(command('rds.disconnect', srv, session.sessionId))
    r.run(command('rds.removeRemoteApp', srv, 'Bureautique', 'notepad'))
    r.run(command('rds.removeCollection', srv, 'Bureautique'))
    done(r)
  })

  it('Hyper-V : commutateurs, machines virtuelles, cartes réseau, démarrage et suppression', () => {
    const r = runner()
    const srv = r.id('SRV1')
    r.run(command('system.installFeatures', srv, ['Hyper-V'], { includeManagementTools: true }))
    r.run(command('hyperv.newSwitch', srv, { name: 'Externe', type: 'External', netAdapter: 'Ethernet0' }))
    r.run(command('hyperv.newSwitch', srv, { name: 'Privé', type: 'Private' }))
    r.run(command('hyperv.newVm', srv, { name: 'VM1', switchName: 'Privé', memoryMB: 2048 }))
    r.run(command('hyperv.addAdapter', srv, 'VM1', 'Externe'))
    r.run(command('hyperv.setMemory', srv, 'VM1', 4096))
    r.run(command('hyperv.connectAdapter', srv, 'VM1', null))
    r.run(command('hyperv.setVmState', srv, 'VM1', true))
    r.run(command('hyperv.setVmState', srv, 'VM1', false))
    r.run(command('hyperv.removeVm', srv, 'VM1'))
    r.run(command('hyperv.removeSwitch', srv, 'Externe'))
    done(r)
  })

  it('toute commande du catalogue est couverte par ce fichier', () => {
    const missing = Object.keys(commandDefinitions()).filter((t) => !covered.has(t))
    expect(missing).toEqual([])
  })
})
