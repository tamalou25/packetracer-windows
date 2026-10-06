import { describe, expect, it } from 'vitest'
import {
  accessPerms,
  addGroup,
  addGroupMembers,
  addOrganizationalUnit,
  addUser,
  createItem,
  createShare,
  domainToken,
  effectiveAccess,
  findNode,
  grantNtfs,
  joinDomain,
  localToken,
  logon,
  openUnc,
  removeItem,
  restartComputer,
  setNtfsInheritance,
  setShareAccess,
  sessionDrives,
  unwrap,
  type Domain,
  type HostDevice,
  type LabState,
  type ServerDevice
} from '@engine/index'
import { build, cable, setIp } from '../helpers'
import { run } from '../shell/helpers'

const DSRM = ['P@ssw0rd!', 'P@ssw0rd!']

/** SRV1 (DC lab.local) + PC1 joint ; utilisateurs jdupont (GG_Compta) et mmartin ; dossier partagé. */
function lab() {
  const { state, ids } = build([
    ['server', 'SRV1'],
    ['client', 'PC1'],
    ['switch', 'SW1']
  ])
  let s = cable(state, ids.SRV1!, 0, ids.SW1!, 0)
  s = cable(s, ids.PC1!, 0, ids.SW1!, 1)
  s = setIp(s, ids.SRV1!, 0, '192.168.1.1/24', undefined, ['8.8.8.8'])
  s = setIp(s, ids.PC1!, 0, '192.168.1.10/24', undefined, ['192.168.1.1'])
  s = run(s, ids.SRV1!, 'Install-WindowsFeature AD-Domain-Services -IncludeManagementTools').state
  s = run(s, ids.SRV1!, 'Install-ADDSForest -DomainName lab.local -InstallDns', {
    answers: [...DSRM, 'O']
  }).state
  const op = joinDomain(s, ids.PC1!, {
    domain: 'lab.local',
    user: 'LAB\\Administrateur',
    password: 'P@ssw0rd'
  })
  s = unwrap(restartComputer(op.state, ids.PC1!)).state
  s = unwrap(addOrganizationalUnit(s, 'lab.local', { name: 'Compta' })).state
  for (const [name, sam] of [
    ['Jean Dupont', 'jdupont'],
    ['Marie Martin', 'mmartin']
  ] as const)
    s = unwrap(
      addUser(s, 'lab.local', {
        name,
        sam,
        path: 'OU=Compta,DC=lab,DC=local',
        password: 'Azerty123!',
        enabled: true
      })
    ).state
  s = unwrap(
    addGroup(s, 'lab.local', { name: 'GG_Compta', scope: 'Global', path: 'OU=Compta,DC=lab,DC=local' })
  ).state
  s = unwrap(addGroupMembers(s, 'lab.local', 'GG_Compta', ['jdupont'])).state
  return { s, ids }
}

const domainOf = (s: LabState) => s.domains['lab.local'] as Domain
const server = (s: LabState, id: string) => s.devices[id] as ServerDevice
const admin = (s: LabState) => domainToken(domainOf(s), 'Administrateur')!
const token = (s: LabState, sam: string) => domainToken(domainOf(s), sam)!

/** C:\Partages\Compta partagé : partage Tout le monde Contrôle total, NTFS GG_Compta Modification. */
function shared() {
  const { s: base, ids } = lab()
  let s = unwrap(
    createItem(base, ids.SRV1!, 'C:\\Partages\\Compta', 'folder', admin(base), { parents: true })
  ).state
  s = unwrap(
    createShare(
      s,
      ids.SRV1!,
      { name: 'Compta', path: 'C:\\Partages\\Compta', full: ['Tout le monde'] },
      admin(s)
    )
  ).state
  s = unwrap(setNtfsInheritance(s, ids.SRV1!, 'C:\\Partages\\Compta', 'remove', admin(s))).state
  s = unwrap(
    grantNtfs(
      s,
      ids.SRV1!,
      'C:\\Partages\\Compta',
      { principal: 'Administrateurs', type: 'Allow', rights: ['FullControl'] },
      admin(s)
    )
  ).state
  s = unwrap(
    grantNtfs(
      s,
      ids.SRV1!,
      'C:\\Partages\\Compta',
      { principal: 'LAB\\GG_Compta', type: 'Allow', rights: ['Modify'] },
      admin(s)
    )
  ).state
  return { s, ids }
}

describe('Fichiers : NTFS', () => {
  it('héritage depuis C:\\, désactivation avec copie ou suppression', () => {
    const { s: base, ids } = lab()
    let s = unwrap(
      createItem(base, ids.SRV1!, 'C:\\Data\\Projets', 'folder', admin(base), { parents: true })
    ).state
    const st = () => server(s, ids.SRV1!).storage
    const node = () => findNode(st(), 'C:\\Data\\Projets')!
    // Utilisateurs : lecture et exécution héritées de la racine
    expect([...accessPerms(st(), node().id, token(s, 'jdupont'))].sort()).toEqual(['execute', 'list', 'read'])
    s = unwrap(setNtfsInheritance(s, ids.SRV1!, 'C:\\Data\\Projets', 'convert', admin(s))).state
    expect(node().inherits).toBe(false)
    expect(node().acl).toHaveLength(3)
    s = unwrap(setNtfsInheritance(s, ids.SRV1!, 'C:\\Data', 'remove', admin(s))).state
    expect(accessPerms(st(), findNode(st(), 'C:\\Data')!.id, token(s, 'jdupont')).size).toBe(0)
    // Utilisateur standard : création refusée sous la racine
    expect(createItem(s, ids.SRV1!, 'C:\\Perso', 'folder', token(s, 'jdupont')).ok).toBe(false)
  })

  it('refus explicite prioritaire, mais une autorisation explicite l’emporte sur un refus hérité', () => {
    const fixture = shared()
    const ids = fixture.ids
    let s = fixture.s
    const path = 'C:\\Partages\\Compta'
    const st = () => server(s, ids.SRV1!).storage
    s = unwrap(
      grantNtfs(s, ids.SRV1!, path, { principal: 'LAB\\jdupont', type: 'Deny', rights: ['Write'] }, admin(s))
    ).state
    const perms = accessPerms(st(), findNode(st(), path)!.id, token(s, 'jdupont'))
    expect(perms.has('read')).toBe(true)
    expect(perms.has('write')).toBe(false)
    // Sous-dossier : autorisation explicite d'écriture → elle passe avant le refus hérité
    s = unwrap(createItem(s, ids.SRV1!, `${path}\\Brouillons`, 'folder', admin(s))).state
    s = unwrap(
      grantNtfs(
        s,
        ids.SRV1!,
        `${path}\\Brouillons`,
        { principal: 'LAB\\jdupont', type: 'Allow', rights: ['Write'] },
        admin(s)
      )
    ).state
    expect(
      accessPerms(st(), findNode(st(), `${path}\\Brouillons`)!.id, token(s, 'jdupont')).has('write')
    ).toBe(true)
  })
})

describe('Fichiers : partages et accès réseau', () => {
  it('droits effectifs = le plus restrictif du partage et du NTFS', () => {
    const fixture = shared()
    const ids = fixture.ids
    let s = fixture.s
    const path = 'C:\\Partages\\Compta'
    const st = () => server(s, ids.SRV1!).storage
    const id = () => findNode(st(), path)!.id
    const share = () => server(s, ids.SRV1!).storage.shares[0]!
    // jdupont : partage Contrôle total ∩ NTFS Modification → Modification
    expect([...accessPerms(st(), id(), token(s, 'jdupont'), share())].sort()).toEqual(
      ['delete', 'execute', 'list', 'read', 'write'].sort()
    )
    // mmartin : aucune autorisation NTFS
    expect(accessPerms(st(), id(), token(s, 'mmartin'), share()).size).toBe(0)
    // Partage limité à la lecture : la modification NTFS ne suffit plus
    s = unwrap(setShareAccess(s, ids.SRV1!, 'Compta', 'Tout le monde', null, admin(s))).state
    s = unwrap(
      setShareAccess(
        s,
        ids.SRV1!,
        'Compta',
        'Utilisateurs authentifiés',
        { type: 'Allow', rights: 'Read' },
        admin(s)
      )
    ).state
    const access = effectiveAccess(st(), id(), token(s, 'jdupont'), share())
    expect(access.find((a) => a.perm === 'write')).toMatchObject({ allowed: false, limitedBy: ['Partage'] })
    expect(access.find((a) => a.perm === 'read')?.allowed).toBe(true)
  })

  it('accès depuis le poste : résolution, SMB tracé, erreurs 53 / 67 / 5', () => {
    const { s, ids } = shared()
    const r = openUnc(s, ids.PC1!, '\\\\SRV1\\Compta', token(s, 'jdupont'))
    expect(r.ok).toBe(true)
    expect(r.trace.events.some((e) => e.protocol === 'SMB')).toBe(true)
    expect(r.trace.events.some((e) => e.protocol === 'DNS')).toBe(true)
    const bad = (path: string, sam = 'jdupont') => {
      const x = openUnc(s, ids.PC1!, path, token(s, sam))
      return x.ok ? 0 : x.code
    }
    expect(bad('\\\\SRV9\\Compta')).toBe(53)
    expect(bad('\\\\SRV1\\Inconnu')).toBe(67)
    expect(bad('\\\\SRV1\\C$')).toBe(5)
    expect(openUnc(s, ids.PC1!, '\\\\SRV1\\C$', admin(s)).ok).toBe(true)
    // Compte local du poste : non reconnu par le serveur
    expect(openUnc(s, ids.PC1!, '\\\\SRV1\\Compta', localToken('PC1', 'Administrateur')).ok).toBe(false)
  })

  it('création et suppression au travers du partage', () => {
    const { s, ids } = shared()
    const viaShare = { share: 'Compta' }
    const created = createItem(
      s,
      ids.SRV1!,
      'C:\\Partages\\Compta\\budget.xlsx',
      'file',
      token(s, 'jdupont'),
      viaShare
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(
      removeItem(
        created.state,
        ids.SRV1!,
        'C:\\Partages\\Compta\\budget.xlsx',
        token(created.state, 'mmartin'),
        viaShare
      ).ok
    ).toBe(false)
    expect(
      removeItem(
        created.state,
        ids.SRV1!,
        'C:\\Partages\\Compta\\budget.xlsx',
        token(created.state, 'jdupont'),
        viaShare
      ).ok
    ).toBe(true)
  })
})

describe('Fichiers : consoles', () => {
  it('PowerShell : New-Item, New-SmbShare, Get-SmbShareAccess, Get-Acl, Get-ChildItem', () => {
    const { s: base, ids } = lab()
    const ps = (state: LabState, line: string, answers: string[] = []) =>
      run(state, ids.SRV1!, line, { answers })
    let r = ps(base, 'New-Item -Path C:\\Partages\\RH -ItemType Directory')
    expect(r.errors).toBe('')
    expect(r.text).toContain('Répertoire : C:\\Partages')
    expect(r.text).toMatch(/d-----\s+05\/01\/2026\s+\d\d:\d\d\s+RH/)
    expect(ps(r.state, 'New-Item -Path C:\\Partages\\RH -ItemType Directory').errors).toContain('existe déjà')
    r = ps(
      r.state,
      'New-SmbShare -Name RH -Path C:\\Partages\\RH -ChangeAccess "LAB\\GG_Compta" -FullAccess "LAB\\Admins du domaine"'
    )
    expect(r.errors).toBe('')
    expect(r.text).toContain('RH   *         C:\\Partages\\RH')
    const access = ps(r.state, 'Get-SmbShareAccess -Name RH')
    expect(access.text).toContain('LAB\\GG_Compta')
    expect(access.text).toContain('Change')
    expect(
      ps(r.state, 'New-SmbShare -Name X -Path C:\\Partages\\RH -ReadAccess "LAB\\inconnu"').errors
    ).toContain('Aucun mappage entre les noms de compte et les ID de sécurité')
    const acl = ps(r.state, '(Get-Acl C:\\Partages\\RH).Access')
    expect(acl.text).toContain('IdentityReference : BUILTIN\\Administrateurs')
    expect(acl.text).toContain('IsInherited       : True')
    expect(ps(r.state, 'Get-SmbShare').text).toContain('C$')
    r = ps(r.state, 'New-Item C:\\Partages\\RH\\note.txt -ItemType File -Value "abc"')
    expect(ps(r.state, 'Get-ChildItem C:\\Partages\\RH').text).toContain('note.txt')
    r = ps(r.state, 'cd C:\\Partages')
    expect(r.session.cwd).toBe('C:\\Partages')
    // Dossier non vide et partagé : confirmation, puis le partage est arrêté avec le dossier
    const removed = run(r.state, ids.SRV1!, 'Remove-Item RH', { session: r.session, answers: ['O'] })
    expect(removed.errors).toBe('')
    expect(removed.prompts[0]).toContain('[O] Oui')
    expect(ps(removed.state, 'Get-SmbShare').text).not.toContain('C:\\Partages\\RH')
  })

  it('cmd : icacls, net share, net use et dir depuis le poste', () => {
    const { s: base, ids } = shared()
    const srv = (state: LabState, line: string, answers: string[] = []) =>
      run(state, ids.SRV1!, line, { shell: 'cmd', answers })
    let r = srv(base, 'icacls C:\\Partages\\Compta')
    expect(r.text).toContain('C:\\Partages\\Compta BUILTIN\\Administrateurs:(OI)(CI)(F)')
    expect(r.text).toContain('LAB\\GG_Compta:(OI)(CI)(M)')
    expect(r.text).toContain('1 fichiers correctement traités ; échec du traitement de 0 fichiers')
    r = srv(r.state, 'icacls C:\\Partages\\Compta /grant LAB\\mmartin:(OI)(CI)RX')
    expect(r.text).toContain('fichier traité : C:\\Partages\\Compta')
    expect(srv(r.state, 'icacls C:\\Partages\\Compta /grant LAB\\personne:R').errors).toContain(
      'Aucun mappage'
    )
    // Compte inconnu : erreur système 1332 (ERROR_NONE_MAPPED), aucun partage créé
    const unknown = srv(r.state, 'net share Inconnu=C:\\Partages /grant:personne,FULL')
    expect(unknown.errors).toContain('Erreur système 1332.')
    expect(unknown.errors).toContain('Aucun mappage entre les noms de compte et les ID de sécurité')
    expect(unknown.state).toBe(r.state)
    const shares = srv(r.state, 'net share')
    expect(shares.text).toMatch(/Compta\s+C:\\Partages\\Compta/)
    expect(shares.text).toMatch(/C\$\s+C:\\\s+Partage par défaut/)
    // Poste : session jdupont, net use, dir sur le lecteur réseau
    const session = logon(r.state, ids.PC1!, { user: 'jdupont', password: 'Azerty123!', domain: 'LAB' })
    expect(session.ok).toBe(true)
    const pc = (state: LabState, line: string, shell: 'cmd' | 'powershell' = 'cmd') =>
      run(state, ids.PC1!, line, { shell })
    let p = pc(session.state, 'net use S: \\\\SRV1\\Compta')
    expect(p.text).toContain('La commande s’est terminée correctement.')
    expect(p.traceEvents).toBeGreaterThan(0)
    expect(
      sessionDrives(p.state.devices[ids.PC1!] as HostDevice, 'LAB\\jdupont').map((d) => d.letter)
    ).toEqual(['S'])
    expect(pc(p.state, 'net use S: \\\\SRV1\\Compta').errors).toContain('Erreur système 85.')
    expect(pc(p.state, 'net use T: \\\\SRV1\\Absent').errors).toContain('Le nom de réseau est introuvable.')
    p = pc(p.state, 'mkdir S:\\2026')
    expect(p.errors).toBe('')
    const listing = pc(p.state, 'dir S:\\')
    expect(listing.text).toContain('Répertoire de \\\\SRV1\\Compta')
    expect(listing.text).toContain('<DIR>          2026')
    expect(pc(p.state, 'net use').text).toMatch(/OK\s+S:\s+\\\\SRV1\\Compta/)
    expect(pc(p.state, 'net view \\\\SRV1').text).toMatch(/Compta\s+Disque\s+S:/)
    // PowerShell : Get-ChildItem sur le chemin UNC
    expect(pc(p.state, 'Get-ChildItem \\\\SRV1\\Compta', 'powershell').text).toContain('2026')
    // Utilisateur sans droits NTFS : accès refusé
    const other = logon(p.state, ids.PC1!, { user: 'mmartin', password: 'Azerty123!', domain: 'LAB' })
    expect(pc(other.state, 'mkdir \\\\SRV1\\Compta\\Test').errors).toContain('Accès refusé.')
    p = pc(p.state, 'net use S: /delete')
    expect(p.text).toContain('S: a été supprimé.')
  })
})
