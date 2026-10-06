import { describe, expect, it } from 'vitest'
import {
  addGroup,
  addGroupMembers,
  addOrganizationalUnit,
  addUser,
  applyDriveMap,
  autoGroupPolicy,
  createGpo,
  DEFAULT_DC_POLICY_ID,
  DEFAULT_DOMAIN_POLICY_ID,
  domainPasswordPolicy,
  executeLine,
  createShellSession,
  gpoPrecedence,
  joinDomain,
  linkGpo,
  logon,
  moveObject,
  parseSlab,
  removeObject,
  restartComputer,
  serializeSlab,
  setGpoSecurityFilter,
  setGpoStatus,
  setInheritanceBlocked,
  unwrap,
  updateGpoLink,
  updateGpoSettings,
  userRsop,
  computerRsop,
  setInterfaceIpv4,
  type Domain,
  type HostDevice,
  type LabState
} from '@engine/index'
import { build, cable, setIp } from '../helpers'
import { run } from '../shell/helpers'

const DSRM = ['P@ssw0rd!', 'P@ssw0rd!']
const COMPTA = 'OU=Compta,DC=lab,DC=local'

/** SRV1 (DC lab.local) + PC1 joint au domaine, OU Compta avec jdupont, OU Postes avec PC1. */
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
  expect(op.ok).toBe(true)
  s = unwrap(restartComputer(op.state, ids.PC1!)).state
  s = unwrap(addOrganizationalUnit(s, 'lab.local', { name: 'Compta' })).state
  s = unwrap(addOrganizationalUnit(s, 'lab.local', { name: 'Postes' })).state
  s = unwrap(
    addUser(s, 'lab.local', {
      name: 'Jean Dupont',
      sam: 'jdupont',
      path: COMPTA,
      password: 'Azerty123!',
      enabled: true
    })
  ).state
  const pc = s.domains['lab.local']?.computers.find((c) => c.name === 'PC1')
  s = unwrap(moveObject(s, 'lab.local', pc?.id ?? '', 'OU=Postes,DC=lab,DC=local')).state
  return { s, ids }
}

const domainOf = (s: LabState): Domain => s.domains['lab.local'] as Domain
const hostOf = (s: LabState, id: string) => s.devices[id] as HostDevice
const ouId = (s: LabState, name: string) => domainOf(s).containers.find((c) => c.name === name)?.id ?? ''

/** Crée une GPO, la lie et renvoie son identifiant. */
function gpo(s: LabState, name: string, target: string | null): { s: LabState; id: string } {
  const created = unwrap(createGpo(s, 'lab.local', { name }))
  return { s: unwrap(linkGpo(created.state, 'lab.local', created.value, target)).state, id: created.value }
}

function logonJdupont(s: LabState, pcId: string) {
  const r = logon(s, pcId, { user: 'jdupont', password: 'Azerty123!', domain: 'LAB' })
  expect(r.message).toBe('')
  expect(r.ok).toBe(true)
  return r
}

describe('GPO : objets par défaut et stratégie de mot de passe', () => {
  it('la promotion crée Default Domain Policy et Default Domain Controllers Policy', () => {
    const { s } = lab()
    const d = domainOf(s)
    expect(d.gpos.map((g) => g.name)).toEqual(['Default Domain Policy', 'Default Domain Controllers Policy'])
    expect(d.gpLinks).toEqual([{ gpoId: DEFAULT_DOMAIN_POLICY_ID, enabled: true, enforced: false }])
    expect(d.containers.find((c) => c.name === 'Domain Controllers')?.gpLinks[0]?.gpoId).toBe(
      DEFAULT_DC_POLICY_ID
    )
    expect(domainPasswordPolicy(d)).toEqual({ minLength: 7, complexity: true })
  })

  it('la longueur minimale du domaine vient des GPO liées à la racine uniquement', () => {
    let { s } = lab()
    s = unwrap(
      updateGpoSettings(s, 'lab.local', DEFAULT_DOMAIN_POLICY_ID, { computer: { minPasswordLength: 12 } })
    ).state
    const tooShort = unwrap(
      addUser(s, 'lab.local', { name: 'A B', sam: 'ab', password: 'Azerty123!', enabled: true })
    )
    expect(tooShort.value.passwordError).toContain('ne répond pas aux spécifications')
    // Une GPO liée à une OU ne change pas la stratégie de mot de passe du domaine
    const ou = gpo(s, 'Mots de passe courts', ouId(s, 'Compta'))
    s = unwrap(updateGpoSettings(ou.s, 'lab.local', ou.id, { computer: { minPasswordLength: 3 } })).state
    expect(domainPasswordPolicy(domainOf(s)).minLength).toBe(12)
    // Valeur hors limites refusée (0 à 14 caractères)
    const invalid = updateGpoSettings(s, 'lab.local', DEFAULT_DOMAIN_POLICY_ID, {
      computer: { minPasswordLength: 20 }
    })
    expect(invalid.ok).toBe(false)
  })
})

describe('GPO : héritage et priorité', () => {
  it('ordre LSDOU, liaisons appliquées et blocage de l’héritage', () => {
    let { s } = lab()
    const a = gpo(s, 'A-Domaine', null)
    const b = gpo(a.s, 'B-Compta', ouId(a.s, 'Compta'))
    s = b.s
    const names = () => gpoPrecedence(domainOf(s), ouId(s, 'Compta')).map((e) => e.gpo.name)
    expect(names()).toEqual(['B-Compta', 'Default Domain Policy', 'A-Domaine'])
    s = unwrap(updateGpoLink(s, 'lab.local', a.id, null, { order: 1 })).state
    expect(names()).toEqual(['B-Compta', 'A-Domaine', 'Default Domain Policy'])
    s = unwrap(setInheritanceBlocked(s, 'lab.local', ouId(s, 'Compta'), true)).state
    expect(names()).toEqual(['B-Compta'])
    // Une liaison appliquée traverse le blocage et l'emporte sur les GPO de l'OU
    s = unwrap(updateGpoLink(s, 'lab.local', a.id, null, { enforced: true })).state
    expect(names()).toEqual(['A-Domaine', 'B-Compta'])
    // Lien désactivé : absent de l'héritage
    s = unwrap(updateGpoLink(s, 'lab.local', b.id, ouId(s, 'Compta'), { enabled: false })).state
    expect(names()).toEqual(['A-Domaine'])
  })

  it('le paramètre de la GPO la plus prioritaire l’emporte ; Appliqué inverse la priorité', () => {
    let { s } = lab()
    const a = gpo(s, 'A-Domaine', null)
    const b = gpo(a.s, 'B-Compta', ouId(a.s, 'Compta'))
    s = unwrap(updateGpoSettings(b.s, 'lab.local', a.id, { user: { noControlPanel: 'Disabled' } })).state
    s = unwrap(updateGpoSettings(s, 'lab.local', b.id, { user: { noControlPanel: 'Enabled' } })).state
    const jdupont = () => domainOf(s).users.find((u) => u.sam === 'jdupont')!
    expect(userRsop(domainOf(s), jdupont()).settings.noControlPanel).toBe('Enabled')
    s = unwrap(updateGpoLink(s, 'lab.local', a.id, null, { enforced: true })).state
    expect(userRsop(domainOf(s), jdupont()).settings.noControlPanel).toBe('Disabled')
  })

  it('raisons de filtrage : sécurité, lien, statut, partie vide', () => {
    let { s } = lab()
    const b = gpo(s, 'B-Compta', ouId(s, 'Compta'))
    s = unwrap(updateGpoSettings(b.s, 'lab.local', b.id, { user: { noRun: 'Enabled' } })).state
    s = unwrap(addGroup(s, 'lab.local', { name: 'GG_Direction', scope: 'Global', path: COMPTA })).state
    s = unwrap(setGpoSecurityFilter(s, 'lab.local', b.id, 'GG_Direction', true)).state
    s = unwrap(setGpoSecurityFilter(s, 'lab.local', b.id, 'Utilisateurs authentifiés', false)).state
    const user = () => domainOf(s).users.find((u) => u.sam === 'jdupont')!
    const reason = () => userRsop(domainOf(s), user()).filtered.find((f) => f.gpo.id === b.id)?.reason
    expect(reason()).toBe('Refusé (Sécurité)')
    s = unwrap(addGroupMembers(s, 'lab.local', 'GG_Direction', ['jdupont'])).state
    expect(userRsop(domainOf(s), user()).applied.map((a) => a.gpo.name)).toContain('B-Compta')
    s = unwrap(setGpoStatus(s, 'lab.local', b.id, 'UserSettingsDisabled')).state
    expect(reason()).toBe('Désactivé (GPO)')
    s = unwrap(setGpoStatus(s, 'lab.local', b.id, 'AllSettingsEnabled')).state
    s = unwrap(updateGpoLink(s, 'lab.local', b.id, ouId(s, 'Compta'), { enabled: false })).state
    expect(reason()).toBe('Désactivé (Lien)')
    // GPO utilisateur liée à l'OU des postes : vide pour l'ordinateur
    const c = gpo(s, 'C-Postes', ouId(s, 'Postes'))
    s = unwrap(updateGpoSettings(c.s, 'lab.local', c.id, { user: { noCmd: 'Enabled' } })).state
    const pc = domainOf(s).computers.find((x) => x.name === 'PC1')!
    expect(computerRsop(domainOf(s), pc).filtered.find((f) => f.gpo.id === c.id)?.reason).toBe(
      'Non appliqué (vide)'
    )
  })

  it('filtrage de sécurité : l’entrée d’un compte supprimé reste visible et peut être retirée', () => {
    const { s: base } = lab()
    const withGroup = unwrap(
      addGroup(base, 'lab.local', { name: 'GG_Compta', scope: 'Global', path: COMPTA })
    ).state
    const gpo = unwrap(createGpo(withGroup, 'lab.local', { name: 'Filtrée' }))
    let s = unwrap(setGpoSecurityFilter(gpo.state, 'lab.local', gpo.value, 'GG_Compta', true)).state
    const group = s.domains['lab.local']!.groups.find((g) => g.name === 'GG_Compta')!
    s = unwrap(removeObject(s, 'lab.local', group.id)).state
    // Comme sous Windows, le droit d'un compte supprimé reste sur la GPO (SID inconnu)
    const filter = () => s.domains['lab.local']!.gpos.find((g) => g.id === gpo.value)!.securityFilter
    expect(filter()).toContain(group.id)
    // La GPMC désigne l'entrée par son identifiant : elle doit pouvoir la retirer
    s = unwrap(setGpoSecurityFilter(s, 'lab.local', gpo.value, group.id, false)).state
    expect(filter()).not.toContain(group.id)
    // Une identité inconnue absente du filtrage reste une erreur
    expect(setGpoSecurityFilter(s, 'lab.local', gpo.value, 'personne', false).ok).toBe(false)
  })

  it('préférences de lecteurs : créer, remplacer, mettre à jour, supprimer', () => {
    const z = {
      action: 'Create' as const,
      letter: 'Z',
      path: '\\\\SRV1\\Commun',
      label: 'Commun',
      reconnect: true
    }
    let list = applyDriveMap([], z)
    expect(list).toHaveLength(1)
    list = applyDriveMap(list, { ...z, path: '\\\\SRV1\\Autre' })
    expect(list[0]?.path).toBe('\\\\SRV1\\Commun')
    list = applyDriveMap(list, { ...z, action: 'Replace', path: '\\\\SRV1\\Autre' })
    expect(list[0]?.path).toBe('\\\\SRV1\\Autre')
    list = applyDriveMap(list, { ...z, action: 'Update', path: '', label: 'Nouveau' })
    expect(list[0]).toMatchObject({ path: '\\\\SRV1\\Autre', label: 'Nouveau' })
    expect(applyDriveMap(list, { ...z, action: 'Delete' })).toEqual([])
  })
})

describe('GPO : application sur le poste', () => {
  it('ouverture de session : stratégie utilisateur et ordinateur appliquées, événements journalisés', () => {
    const fixture = lab()
    const ids = fixture.ids
    let s = fixture.s
    const b = gpo(s, 'GPO-Compta', ouId(s, 'Compta'))
    s = unwrap(
      updateGpoSettings(b.s, 'lab.local', b.id, {
        user: {
          noControlPanel: 'Enabled',
          wallpaper: {
            state: 'Enabled',
            path: 'C:\\Windows\\Web\\Wallpaper\\ServerLab\\aurore.jpg',
            style: 'Fill'
          },
          driveMaps: [
            { action: 'Update', letter: 'S', path: '\\\\SRV1\\Compta', label: 'Compta', reconnect: true }
          ]
        }
      })
    ).state
    const r = logonJdupont(s, ids.PC1!)
    const policy = hostOf(r.state, ids.PC1!).host.policy
    expect(policy.user?.account).toBe('LAB\\jdupont')
    // La Default Domain Policy ne contient aucun paramètre utilisateur : filtrée (vide), comme en réel
    expect(policy.user?.applied.map((a) => a.name)).toEqual(['GPO-Compta'])
    expect(policy.user?.filtered).toContainEqual(
      expect.objectContaining({ name: 'Default Domain Policy', reason: 'Non appliqué (vide)' })
    )
    expect(policy.user?.settings.noControlPanel).toBe('Enabled')
    expect(policy.user?.settings.driveMaps.map((d) => d.letter)).toEqual(['S'])
    expect(policy.computer?.applied.map((a) => a.name)).toEqual(['Default Domain Policy'])
    expect(policy.computer?.source).toBe('srv1.lab.local')
    const events = hostOf(r.state, ids.PC1!).host.eventLog.filter((e) => e.source === 'GroupPolicy')
    expect(events.map((e) => e.eventId)).toEqual([1502, 1503])
    // Échanges LDAP et SMB visibles dans la trace d'ouverture de session
    const protocols = new Set(r.trace.events.map((e) => e.protocol))
    expect(protocols.has('SMB')).toBe(true)
    expect(protocols.has('LDAP')).toBe(true)
  })

  it('gpupdate /force applique une modification ; échec si le contrôleur est injoignable', () => {
    const fixture = lab()
    const ids = fixture.ids
    let s = fixture.s
    s = logonJdupont(s, ids.PC1!).state
    const b = gpo(s, 'GPO-Compta', ouId(s, 'Compta'))
    s = unwrap(updateGpoSettings(b.s, 'lab.local', b.id, { user: { noCmd: 'Enabled' } })).state
    expect(hostOf(s, ids.PC1!).host.policy.user?.settings.noCmd).toBe('NotConfigured')
    const ok = run(s, ids.PC1!, 'gpupdate /force', { shell: 'cmd' })
    expect(ok.text).toContain('La mise à jour de la stratégie d’ordinateur s’est terminée sans erreur.')
    expect(ok.text).toContain('La mise à jour de la stratégie utilisateur s’est terminée sans erreur.')
    expect(ok.traceEvents).toBeGreaterThan(0)
    expect(hostOf(ok.state, ids.PC1!).host.policy.user?.settings.noCmd).toBe('Enabled')
    // L'invite de commandes est maintenant interdite (PowerShell reste disponible)
    const blocked = executeLine(ok.state, createShellSession(ok.state, ids.PC1!, 'cmd'), 'ipconfig')
    expect(blocked.output.map((l) => l.text)).toEqual([
      'L’invite de commandes a été désactivée par votre administrateur.'
    ])
    expect(run(ok.state, ids.PC1!, 'hostname').text).toBe('PC1')
    // DNS du poste incorrect : pas de contrôleur
    const pc = hostOf(ok.state, ids.PC1!)
    const broken = unwrap(
      setInterfaceIpv4(ok.state, ids.PC1!, pc.interfaces[0]!.id, {
        addressing: 'static',
        address: '192.168.1.10',
        mask: '24',
        gateway: null,
        dnsServers: ['8.8.8.8']
      })
    ).state
    const ko = run(broken, ids.PC1!, 'gpupdate', { shell: 'powershell' })
    expect(ko.errors).toContain('n’a pas pu se terminer correctement')
    expect(ko.errors).toContain('aucune connectivité réseau vers un contrôleur de domaine')
    expect(hostOf(ko.state, ids.PC1!).host.eventLog.some((e) => e.eventId === 1129)).toBe(true)
  })

  it('gpresult /r : utilisateur standard sans données ordinateur, administrateur complet', () => {
    const fixture = lab()
    const ids = fixture.ids
    let s = fixture.s
    const b = gpo(s, 'GPO-Compta', ouId(s, 'Compta'))
    s = unwrap(updateGpoSettings(b.s, 'lab.local', b.id, { user: { noRun: 'Enabled' } })).state
    const c = gpo(s, 'GPO-Vide', ouId(s, 'Compta'))
    s = logonJdupont(c.s, ids.PC1!).state
    const r = run(s, ids.PC1!, 'gpresult /r', { shell: 'cmd' })
    expect(r.text).toContain('Données RSOP pour LAB\\jdupont sur PC1 : Mode de journalisation')
    expect(r.text).not.toContain('PARAMÈTRES DE L’ORDINATEUR')
    expect(r.text).toContain('CN=Jean Dupont,OU=Compta,DC=lab,DC=local')
    expect(r.text).toMatch(/Objets Stratégie de groupe appliqués\n\s+-+\n\s+GPO-Compta\n\n/)
    expect(r.text).toMatch(/GPO-Vide\n\s+Filtrage : {2}Non appliqué \(vide\)/)
    expect(run(s, ids.PC1!, 'gpresult /r /scope computer', { shell: 'cmd' }).errors).toBe(
      'ERREUR : Accès refusé.'
    )
    const v = run(s, ids.PC1!, 'gpresult /v', { shell: 'cmd' })
    expect(v.text).toContain('Supprimer le menu Exécuter du menu Démarrer')
    // Administrateur du domaine sur le contrôleur : partie ordinateur visible
    s = run(s, ids.SRV1!, 'gpupdate').state
    const admin = run(s, ids.SRV1!, 'gpresult /r', { shell: 'cmd' })
    expect(admin.text).toContain('PARAMÈTRES DE L’ORDINATEUR')
    expect(admin.text).toContain('Contrôleur de domaine principal')
    expect(admin.text).toMatch(/Default Domain Controllers Policy\n\s+Default Domain Policy/)
  })

  it('traitement en arrière-plan après redémarrage, une seule tentative par démarrage', () => {
    const fixture = lab()
    const ids = fixture.ids
    let s = fixture.s
    const t = gpo(s, 'Message', null)
    s = unwrap(
      updateGpoSettings(t.s, 'lab.local', t.id, {
        computer: { logonMessageTitle: 'Avertissement', logonMessageText: 'Accès réservé.' }
      })
    ).state
    s = unwrap(restartComputer(s, ids.PC1!)).state
    const first = autoGroupPolicy(s)
    const pc = hostOf(first.state, ids.PC1!)
    expect(pc.host.policy.computer?.boot).toBe(pc.host.bootedAt)
    expect(pc.host.policy.computer?.settings.logonMessageTitle).toBe('Avertissement')
    expect(first.traces.length).toBeGreaterThan(0)
    expect(autoGroupPolicy(first.state).state).toBe(first.state)
  })
})

describe('GPO : PowerShell (module GroupPolicy)', () => {
  it('New-GPO, New-GPLink, héritage, filtrage et suppression', () => {
    const { s: base, ids } = lab()
    const ps = (state: LabState, line: string, answers: string[] = []) =>
      run(state, ids.SRV1!, line, { answers })
    let r = ps(base, 'New-GPO -Name "GPO-Compta" -Comment "Paramètres comptables"')
    expect(r.errors).toBe('')
    expect(r.text).toContain('DisplayName      : GPO-Compta')
    expect(r.text).toContain('GpoStatus        : AllSettingsEnabled')
    expect(ps(r.state, 'New-GPO GPO-Compta').errors).toContain('existe déjà dans le domaine lab.local')
    r = ps(r.state, `New-GPLink -Name GPO-Compta -Target "${COMPTA}"`)
    expect(r.text).toContain('Target      : OU=Compta,DC=lab,DC=local')
    expect(r.text).toContain('Order       : 1')
    expect(ps(r.state, `New-GPLink -Name GPO-Compta -Target "${COMPTA}"`).errors).toContain('est déjà lié')
    expect(ps(r.state, 'New-GPLink -Name GPO-Compta -Target "CN=Users,DC=lab,DC=local"').errors).toContain(
      'ne peuvent être liés qu’à un site, à un domaine ou à une unité d’organisation'
    )
    const inh = ps(r.state, `Get-GPInheritance -Target "${COMPTA}"`)
    expect(inh.text).toContain('GpoInheritanceBlocked : No')
    expect(inh.text).toContain('InheritedGpoLinks     : {GPO-Compta, Default Domain Policy}')
    r = ps(r.state, `Set-GPInheritance -Target "${COMPTA}" -IsBlocked Yes`)
    expect(r.text).toContain('InheritedGpoLinks     : {GPO-Compta}')
    r = ps(r.state, 'Set-GPLink -Name "Default Domain Policy" -Target "DC=lab,DC=local" -Enforced Yes')
    expect(r.text).toContain('Enforced    : True')
    expect(ps(r.state, `Get-GPInheritance -Target "${COMPTA}"`).text).toContain(
      'InheritedGpoLinks     : {Default Domain Policy, GPO-Compta}'
    )
    r = ps(r.state, 'New-ADGroup GG_Compta Global -Path "OU=Compta,DC=lab,DC=local"')
    r = ps(
      r.state,
      'Set-GPPermission -Name GPO-Compta -TargetName GG_Compta -TargetType Group -PermissionLevel GpoApply'
    )
    expect(r.errors).toBe('')
    const perms = ps(r.state, 'Get-GPPermission -Name GPO-Compta -All')
    expect(perms.text).toContain('Trustee     : GG_Compta')
    expect(
      ps(
        r.state,
        'Set-GPPermission -Name GPO-Compta -TargetName "Utilisateurs authentifiés" -TargetType Group -PermissionLevel None'
      ).errors
    ).toContain('-Replace')
    r = ps(
      r.state,
      'Set-GPPermission -Name GPO-Compta -TargetName "Utilisateurs authentifiés" -TargetType Group -PermissionLevel None -Replace'
    )
    expect(domainOf(r.state).gpos.find((g) => g.name === 'GPO-Compta')?.securityFilter).toHaveLength(1)
    expect(ps(r.state, 'Get-GPO -All').text).toContain('DisplayName      : Default Domain Controllers Policy')
    r = ps(r.state, `Remove-GPLink -Name GPO-Compta -Target "${COMPTA}"`)
    expect(domainOf(r.state).containers.find((c) => c.name === 'Compta')?.gpLinks).toEqual([])
    r = ps(r.state, 'Remove-GPO -Name GPO-Compta', ['O'])
    expect(domainOf(r.state).gpos.some((g) => g.name === 'GPO-Compta')).toBe(false)
    expect(ps(r.state, 'Get-GPO GPO-Compta').errors).toContain('est introuvable dans le domaine lab.local')
    // Utilisateur standard : écriture refusée
    const pc = logonJdupont(r.state, ids.PC1!).state
    expect(run(pc, ids.PC1!, 'New-GPO Test').errors).toContain("n'est pas reconnu")
  })

  it('migration d’un fichier au format 1 : GPO par défaut ajoutées au domaine', () => {
    const { s } = lab()
    const doc = JSON.parse(serializeSlab(s, { savedAt: '2026-10-05T10:00:00Z', appVersion: '0.0.0' }))
    doc.schemaVersion = 1
    const domain = doc.lab.domains['lab.local']
    delete domain.gpos
    delete domain.gpLinks
    for (const c of domain.containers) delete c.gpLinks
    const parsed = parseSlab(JSON.stringify(doc))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const migrated = parsed.doc.lab.domains['lab.local'] as Domain
    expect(migrated.gpos).toHaveLength(2)
    expect(migrated.gpLinks[0]?.gpoId).toBe(DEFAULT_DOMAIN_POLICY_ID)
    expect(migrated.containers.find((c) => c.name === 'Domain Controllers')?.gpLinks[0]?.gpoId).toBe(
      DEFAULT_DC_POLICY_ID
    )
  })
})
