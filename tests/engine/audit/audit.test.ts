/**
 * Audit de sécurité : chaque règle testée seule (enfreinte, puis corrigée), score et tri par
 * gravité, comparaison avec un audit antérieur.
 */
import { describe, expect, it } from 'vitest'
import {
  auditRules,
  auditLab,
  command,
  compareAudits,
  DEFAULT_DOMAIN_POLICY_ID,
  dispatch,
  runIosScript,
  type AnyCommand,
  type LabState
} from '@engine/index'
import { buildReferenceLab } from '../serialization/reference-lab'
import { run } from '../shell/helpers'

const D = 'lab.local'
const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''
const rule = (ruleId: string) => auditRules().find((r) => r.id === ruleId)!

function exec(state: LabState, ...cmds: AnyCommand[]): LabState {
  let s = state
  for (const cmd of cmds) {
    const r = dispatch(s, cmd)
    if (!r.ok) throw new Error(`${cmd.type} : ${r.error.message}`)
    s = r.state
  }
  return s
}

/** Trunk du switch Cisco CSW1 durci (DTP coupé, VLAN natif dédié) : aucune règle IOS enfreinte. */
function hardenCisco(s: LabState): LabState {
  return runIosScript(s, id(s, 'CSW1'), [
    'enable',
    'configure terminal',
    'vlan 999',
    'interface Gi0/1',
    'switchport nonegotiate',
    'switchport trunk native vlan 999',
    'end'
  ])
}

/** Lab de référence avec une stratégie de mot de passe conforme (12 caractères, complexité). */
function hardened(): LabState {
  return exec(
    hardenCisco(buildReferenceLab()),
    command('gpo.updateSettings', D, DEFAULT_DOMAIN_POLICY_ID, {
      computer: { minPasswordLength: 12, passwordComplexity: true }
    })
  )
}

const ps = (s: LabState, line: string, answers: string[] = []) =>
  run(s, id(s, 'SRV1'), line, { answers }).state

describe('Audit de sécurité : règles', () => {
  it('lab conforme : score 100, aucune recommandation', () => {
    const report = auditLab(hardened())
    expect(report.recommendations).toEqual([])
    expect(report.score).toBe(100)
    expect(report.passed).toEqual(auditRules().map((r) => r.id))
  })

  it('SMB 1.0 activé (critique)', () => {
    let s = ps(hardened(), 'Set-SmbServerConfiguration -EnableSMB1Protocol $true -Force')
    expect(rule('smb1').check(s)).toEqual([{ object: 'SRV1', detail: expect.stringContaining('SMB 1.0') }])
    expect(auditLab(s).score).toBe(75)
    s = ps(s, 'Set-SmbServerConfiguration -EnableSMB1Protocol $false -Force')
    expect(rule('smb1').check(s)).toEqual([])
  })

  it('trop de membres dans Admins du domaine', () => {
    let s = hardened()
    for (const sam of ['admin2', 'admin3'])
      s = ps(
        s,
        `New-ADUser -Name ${sam} -AccountPassword (ConvertTo-SecureString 'Azerty123!Az' -AsPlainText -Force) -Enabled $true`
      )
    s = ps(s, "Add-ADGroupMember -Identity 'Admins du domaine' -Members admin2,admin3")
    const findings = rule('domainAdmins').check(s)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.detail).toContain('3 comptes activés')
    s = ps(s, "Remove-ADGroupMember -Identity 'Admins du domaine' -Members admin3 -Confirm:$false")
    expect(rule('domainAdmins').check(s)).toEqual([])
  })

  it('partage « Tout le monde : Contrôle total »', () => {
    let s = ps(hardened(), 'New-Item -ItemType Directory -Path C:\\Public')
    s = ps(s, 'New-SmbShare -Name Public -Path C:\\Public -FullAccess Everyone')
    expect(rule('everyoneFullControl').check(s)).toEqual([
      { object: 'SRV1 › partage Public', detail: expect.any(String) }
    ])
    s = ps(s, 'Revoke-SmbShareAccess -Name Public -AccountName Everyone -Force')
    s = ps(s, 'Grant-SmbShareAccess -Name Public -AccountName Everyone -AccessRight Read -Force')
    expect(rule('everyoneFullControl').check(s)).toEqual([])
  })

  it('pare-feu désactivé', () => {
    let s = ps(hardened(), 'Set-NetFirewallProfile -Profile Public -Enabled False')
    expect(
      rule('firewallDisabled')
        .check(s)
        .map((f) => f.object)
    ).toEqual(['SRV1 (profil Public)'])
    s = ps(s, 'Set-NetFirewallProfile -All -Enabled True')
    expect(rule('firewallDisabled').check(s)).toEqual([])
  })

  it('stratégie de mot de passe faible (lab de référence : 7 caractères)', () => {
    const findings = rule('weakPasswordPolicy').check(buildReferenceLab())
    expect(findings).toEqual([{ object: D, detail: expect.stringContaining('longueur minimale 7') }])
    const s = exec(
      hardened(),
      command('gpo.updateSettings', D, DEFAULT_DOMAIN_POLICY_ID, { computer: { passwordComplexity: false } })
    )
    expect(rule('weakPasswordPolicy').check(s)[0]?.detail).toContain('complexité désactivée')
  })

  it('mots de passe sans expiration', () => {
    let s = ps(hardened(), 'Set-ADUser jdupont -PasswordNeverExpires $true')
    expect(
      rule('passwordNeverExpires')
        .check(s)
        .map((f) => f.object)
    ).toEqual(['LAB\\jdupont'])
    expect(run(s, id(s, 'SRV1'), 'Get-ADUser jdupont -Properties PasswordNeverExpires').text).toMatch(
      /PasswordNeverExpires\s+: True/
    )
    s = ps(s, 'Set-ADUser jdupont -PasswordNeverExpires $false')
    expect(rule('passwordNeverExpires').check(s)).toEqual([])
  })

  it('comptes inactifs : jamais utilisé depuis plus de 90 jours, puis ouverture de session', () => {
    const s = hardened()
    const later = { ...s, clock: s.clock + 120 * 86_400_000 }
    expect(
      rule('inactiveAccounts')
        .check(later)
        .map((f) => f.object)
    ).toEqual(['LAB\\jdupont'])
    const r = dispatch(
      later,
      command('adds.logon', id(s, 'PC1'), { user: 'jdupont', password: 'Azerty123!', domain: 'LAB' })
    )
    if (!r.ok || !r.value.success) throw new Error('ouverture de session')
    expect(rule('inactiveAccounts').check(r.state)).toEqual([])
  })
})

describe('Audit de sécurité : rapport', () => {
  it('score, tri par gravité, objets et corrections', () => {
    let s = ps(
      hardenCisco(buildReferenceLab()),
      'Set-SmbServerConfiguration -EnableSMB1Protocol $true -Force'
    )
    s = ps(s, 'Set-ADUser jdupont -PasswordNeverExpires $true')
    const report = auditLab(s)
    expect(report.recommendations.map((r) => [r.rule, r.severity])).toEqual([
      ['smb1', 'critique'],
      ['weakPasswordPolicy', 'élevée'],
      ['passwordNeverExpires', 'moyenne']
    ])
    expect(report.score).toBe(100 - 25 - 15 - 10)
    expect(report.recommendations.every((r) => r.fix.length > 20 && r.findings.length > 0)).toBe(true)
  })

  it('comparaison : recommandations corrigées depuis l’audit de référence', () => {
    let s = ps(
      hardenCisco(buildReferenceLab()),
      'Set-SmbServerConfiguration -EnableSMB1Protocol $true -Force'
    )
    const before = auditLab(s)
    s = ps(s, 'Set-SmbServerConfiguration -EnableSMB1Protocol $false -Force')
    s = ps(s, 'Set-ADUser jdupont -PasswordNeverExpires $true')
    const rows = compareAudits(before, auditLab(s))
    expect(rows.map((r) => [r.rule, r.corrected])).toEqual([
      ['smb1', true],
      ['weakPasswordPolicy', false],
      ['passwordNeverExpires', false]
    ])
  })
})
