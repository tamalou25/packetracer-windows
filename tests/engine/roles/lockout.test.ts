/**
 * Verrouillage des comptes (seuil, durée, réinitialisation, évènement 4740, déverrouillage) et
 * stratégie d'audit par GPO qui conditionne les évènements de sécurité.
 */
import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_LOCKED,
  DEFAULT_DOMAIN_POLICY_ID,
  command,
  dispatch,
  type HostDevice,
  type LabState
} from '@engine/index'
import { buildReferenceLab } from '../serialization/reference-lab'
import { run } from '../shell/helpers'

const DOMAIN = 'lab.local'
const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''
const securityIds = (s: LabState, name: string) =>
  (s.devices[id(s, name)] as HostDevice).host.eventLog
    .filter((e) => e.log === 'Sécurité')
    .map((e) => e.eventId)
const user = (s: LabState, sam: string) => s.domains[DOMAIN]!.users.find((u) => u.sam === sam)!

function apply(s: LabState, cmd: Parameters<typeof dispatch>[1]): LabState {
  const r = dispatch(s, cmd)
  if (!r.ok) throw new Error(r.error.message)
  return r.state
}

function logon(s: LabState, password: string, sam = 'jdupont') {
  const r = dispatch(s, command('adds.logon', id(s, 'PC1'), { user: sam, password, domain: 'LAB' }))
  if (!r.ok) throw new Error(r.error.message)
  return { state: r.state, value: r.value as { success: boolean; message: string } }
}

/** Default Domain Policy : seuil de 3 échecs, durée et réinitialisation de 30 minutes. */
function withLockout(s: LabState, duration = 30, reset = 30): LabState {
  return apply(
    s,
    command('gpo.updateSettings', DOMAIN, DEFAULT_DOMAIN_POLICY_ID, {
      computer: { lockoutThreshold: 3, lockoutDuration: duration, lockoutReset: reset }
    })
  )
}

const advance = (s: LabState, minutes: number): LabState => ({ ...s, clock: s.clock + minutes * 60_000 })

describe('Verrouillage des comptes', () => {
  it('sans stratégie (seuil 0), les échecs ne verrouillent jamais le compte', () => {
    let s = buildReferenceLab()
    for (let i = 0; i < 5; i++) s = logon(s, 'faux').state
    expect(user(s, 'jdupont').lockoutTime).toBeNull()
    expect(user(s, 'jdupont').badPwdCount).toBe(5)
    expect(logon(s, 'Azerty123!').value.success).toBe(true)
  })

  it('N échecs → compte verrouillé, 4740 sur le contrôleur, bon mot de passe refusé', () => {
    let s = withLockout(buildReferenceLab())
    const first = logon(s, 'faux')
    expect(first.value.message).not.toBe(ACCOUNT_LOCKED)
    s = logon(first.state, 'faux').state
    const before = securityIds(s, 'SRV1').length
    const third = logon(s, 'faux')
    // La tentative qui atteint le seuil reste un mauvais mot de passe
    expect(third.value.message).not.toBe(ACCOUNT_LOCKED)
    s = third.state
    expect(user(s, 'jdupont').lockoutTime).not.toBeNull()
    expect(securityIds(s, 'SRV1').slice(before)).toContain(4740)
    const event = (s.devices[id(s, 'SRV1')] as HostDevice).host.eventLog.find((e) => e.eventId === 4740)
    expect(event?.message).toContain('Compte : LAB\\jdupont')
    expect(event?.message).toContain('Ordinateur appelant : PC1')
    // Verrouillé : même le bon mot de passe est refusé, le KDC répond 4768 code 0x12
    const n = securityIds(s, 'SRV1').length
    const locked = logon(s, 'Azerty123!')
    expect(locked.value.success).toBe(false)
    expect(locked.value.message).toBe(ACCOUNT_LOCKED)
    const dcLog = (locked.state.devices[id(s, 'SRV1')] as HostDevice).host.eventLog.slice(n)
    expect(dcLog.find((e) => e.eventId === 4768)?.message).toContain('0x12')
    // Un compte verrouillé ne voit pas son compteur grimper
    expect(user(locked.state, 'jdupont').badPwdCount).toBe(3)
  })

  it('déverrouillage automatique une fois la durée écoulée', () => {
    let s = withLockout(buildReferenceLab(), 15, 15)
    for (let i = 0; i < 3; i++) s = logon(s, 'faux').state
    expect(logon(advance(s, 14), 'Azerty123!').value.message).toBe(ACCOUNT_LOCKED)
    const after = logon(advance(s, 15), 'Azerty123!')
    expect(after.value.success).toBe(true)
    expect(user(after.state, 'jdupont').lockoutTime).toBeNull()
    expect(user(after.state, 'jdupont').badPwdCount).toBe(0)
  })

  it('durée 0 : verrouillé jusqu’au déverrouillage par un administrateur', () => {
    let s = withLockout(buildReferenceLab(), 0, 30)
    for (let i = 0; i < 3; i++) s = logon(s, 'faux').state
    expect(logon(advance(s, 60 * 24), 'Azerty123!').value.message).toBe(ACCOUNT_LOCKED)
  })

  it('le compteur d’échecs repart de zéro après le délai de réinitialisation', () => {
    let s = withLockout(buildReferenceLab(), 30, 10)
    s = logon(s, 'faux').state
    s = logon(s, 'faux').state
    s = advance(s, 10)
    s = logon(s, 'faux').state
    expect(user(s, 'jdupont').badPwdCount).toBe(1)
    expect(user(s, 'jdupont').lockoutTime).toBeNull()
  })

  it('une ouverture de session réussie remet le compteur à zéro', () => {
    let s = withLockout(buildReferenceLab())
    s = logon(s, 'faux').state
    s = logon(s, 'faux').state
    s = logon(s, 'Azerty123!').state
    expect(user(s, 'jdupont').badPwdCount).toBe(0)
  })

  it('réinitialisation supérieure à la durée : refusée', () => {
    const r = dispatch(
      buildReferenceLab(),
      command('gpo.updateSettings', DOMAIN, DEFAULT_DOMAIN_POLICY_ID, {
        computer: { lockoutThreshold: 3, lockoutDuration: 10, lockoutReset: 30 }
      })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.message).toContain('inférieure ou égale à la durée de verrouillage')
  })

  it('Search-ADAccount -LockedOut, Get-ADUser LockedOut et Unlock-ADAccount', () => {
    let s = withLockout(buildReferenceLab())
    for (let i = 0; i < 3; i++) s = logon(s, 'faux').state
    const srv = id(s, 'SRV1')
    const search = run(s, srv, 'Search-ADAccount -LockedOut | Select-Object -ExpandProperty SamAccountName')
    expect(search.text.trim()).toBe('jdupont')
    expect(run(s, srv, 'Get-ADUser jdupont -Properties LockedOut').text).toMatch(/LockedOut\s*:\s*True/)
    const ambiguous = run(s, srv, 'Search-ADAccount')
    expect(ambiguous.errors).toContain('Le jeu de paramètres ne peut pas être résolu')
    s = run(s, srv, 'Unlock-ADAccount -Identity jdupont').state
    expect(user(s, 'jdupont').lockoutTime).toBeNull()
    expect(run(s, srv, 'Search-ADAccount -LockedOut').text.trim()).toBe('')
    expect(logon(s, 'Azerty123!').value.success).toBe(true)
  })

  it('déverrouillage par commande (console AD) : état identique à Unlock-ADAccount', () => {
    let s = withLockout(buildReferenceLab())
    for (let i = 0; i < 3; i++) s = logon(s, 'faux').state
    const gui = apply(s, command('adds.unlockAccount', DOMAIN, 'jdupont'))
    const ps = run(s, id(s, 'SRV1'), 'Unlock-ADAccount jdupont').state
    expect(gui.domains).toEqual(ps.domains)
  })
})

describe('Stratégie d’audit par GPO', () => {
  /** GPO « Audit » liée à la racine du domaine, appliquée par gpupdate sur PC1 et SRV1. */
  function withAudit(s: LabState, settings: Record<string, string>): LabState {
    s = apply(s, command('gpo.createAndLink', DOMAIN, { name: 'Audit' }, null))
    const gpo = s.domains[DOMAIN]!.gpos.find((g) => g.name === 'Audit')!
    s = apply(s, command('gpo.updateSettings', DOMAIN, gpo.id, { computer: settings }))
    s = run(s, id(s, 'PC1'), 'gpupdate /force', { shell: 'cmd' }).state
    s = run(s, id(s, 'SRV1'), 'gpupdate /force', { shell: 'cmd' }).state
    return s
  }

  it('par défaut, ouvertures de session (succès, échecs) et gestion des comptes sont auditées', () => {
    let s = buildReferenceLab()
    const n = securityIds(s, 'PC1').length
    s = logon(s, 'faux').state
    s = logon(s, 'Azerty123!').state
    expect(securityIds(s, 'PC1').slice(n)).toEqual([4625, 4624])
  })

  it('ouvertures de session : « Pas d’audit » supprime 4624 / 4625, « Échec » ne garde que 4625', () => {
    let s = withAudit(buildReferenceLab(), { auditLogon: 'None' })
    let n = securityIds(s, 'PC1').length
    s = logon(s, 'faux').state
    s = logon(s, 'Azerty123!').state
    expect(securityIds(s, 'PC1').slice(n)).toEqual([])
    s = withAudit(buildReferenceLab(), { auditLogon: 'Failure' })
    n = securityIds(s, 'PC1').length
    s = logon(s, 'faux').state
    s = logon(s, 'Azerty123!').state
    expect(securityIds(s, 'PC1').slice(n)).toEqual([4625])
  })

  it('la stratégie ne s’applique qu’après gpupdate sur l’ordinateur', () => {
    let s = buildReferenceLab()
    s = apply(s, command('gpo.createAndLink', DOMAIN, { name: 'Audit' }, null))
    const gpo = s.domains[DOMAIN]!.gpos.find((g) => g.name === 'Audit')!
    s = apply(s, command('gpo.updateSettings', DOMAIN, gpo.id, { computer: { auditLogon: 'None' } }))
    const n = securityIds(s, 'PC1').length
    s = logon(s, 'Azerty123!').state
    expect(securityIds(s, 'PC1').slice(n)).toEqual([4624])
  })

  it('gestion des comptes : « Pas d’audit » supprime 4720 et 4728 sur le contrôleur', () => {
    let s = withAudit(buildReferenceLab(), { auditAccountManagement: 'None' })
    const srv = id(s, 'SRV1')
    const n = securityIds(s, 'SRV1').length
    s = run(
      s,
      srv,
      "New-ADUser -Name mmartin -AccountPassword (ConvertTo-SecureString 'Azerty123!' -AsPlainText -Force) -Enabled $true"
    ).state
    s = run(s, srv, 'Add-ADGroupMember -Identity GG_Compta -Members mmartin').state
    expect(user(s, 'mmartin')).toBeDefined()
    expect(
      securityIds(s, 'SRV1')
        .slice(n)
        .filter((e) => [4720, 4728].includes(e))
    ).toEqual([])
  })

  it('4740 suit la stratégie de gestion des comptes du contrôleur', () => {
    let s = withAudit(buildReferenceLab(), { auditAccountManagement: 'None' })
    s = withLockout(s)
    for (let i = 0; i < 3; i++) s = logon(s, 'faux').state
    expect(user(s, 'jdupont').lockoutTime).not.toBeNull()
    expect(securityIds(s, 'SRV1')).not.toContain(4740)
  })
})
