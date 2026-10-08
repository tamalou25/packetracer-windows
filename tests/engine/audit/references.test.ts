/**
 * Référentiels de l'audit (ANSSI, CIS Controls v8) : chaque règle cite au moins une recommandation,
 * le rapport les reprend et coche une recommandation quand toutes ses règles sont respectées.
 */
import { describe, expect, it } from 'vitest'
import {
  AUDIT_REFERENCES,
  auditLab,
  auditRules,
  buildAuditReport,
  command,
  DEFAULT_DOMAIN_POLICY_ID,
  dispatch,
  referenceStatuses,
  runIosScript,
  type LabState
} from '@engine/index'
import { buildReferenceLab } from '../serialization/reference-lab'
import { run } from '../shell/helpers'

const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''
const ps = (s: LabState, line: string) => run(s, id(s, 'SRV1'), line).state

/** Lab de référence conforme : stratégie de mot de passe et trunk Cisco durcis. */
function hardened(): LabState {
  let s = buildReferenceLab()
  s = runIosScript(s, id(s, 'CSW1'), [
    'enable',
    'configure terminal',
    'vlan 999',
    'interface Gi0/1',
    'switchport nonegotiate',
    'switchport trunk native vlan 999',
    'end'
  ])
  const r = dispatch(
    s,
    command('gpo.updateSettings', 'lab.local', DEFAULT_DOMAIN_POLICY_ID, {
      computer: { minPasswordLength: 12, passwordComplexity: true }
    })
  )
  if (!r.ok) throw new Error(r.error.message)
  s = r.state
  return s
}

describe('Référentiels de l’audit', () => {
  it('chaque règle cite au moins une recommandation ANSSI et une CIS connues', () => {
    for (const rule of auditRules()) {
      const refs = rule.refs ?? []
      expect(refs.length, rule.id).toBeGreaterThan(0)
      for (const key of refs) expect(AUDIT_REFERENCES[key], `${rule.id} › ${key}`).toBeDefined()
      expect(
        refs.some((k) => k.startsWith('anssi-')),
        rule.id
      ).toBe(true)
      expect(
        refs.some((k) => k.startsWith('cis-')),
        rule.id
      ).toBe(true)
    }
  })

  it('lab conforme : toutes les recommandations cochées', () => {
    const statuses = referenceStatuses(auditLab(hardened()), auditRules())
    expect(statuses.length).toBeGreaterThan(5)
    expect(statuses.every((r) => r.satisfied)).toBe(true)
  })

  it('SMB 1.0 activé décoche ANSSI 21 et CIS 4.8 ; la correction fait monter la note et les coche', () => {
    const before = ps(hardened(), 'Set-SmbServerConfiguration -EnableSMB1Protocol $true -Force')
    const unchecked = referenceStatuses(auditLab(before), auditRules()).filter((r) => !r.satisfied)
    expect(unchecked.map((r) => r.key)).toEqual(['anssi-21', 'cis-4.8'])
    const after = ps(before, 'Set-SmbServerConfiguration -EnableSMB1Protocol $false -Force')
    expect(auditLab(after).score).toBeGreaterThan(auditLab(before).score)
    const doc = buildAuditReport({
      lab: 'Lab',
      date: 'd',
      current: auditLab(after),
      baseline: auditLab(before)
    })
    expect(doc.items.find((i) => i.rule === 'smb1')).toMatchObject({
      status: 'corrigé',
      refs: [
        { label: 'ANSSI 21', verified: false },
        {
          label: 'CIS 4.8',
          title: 'Uninstall or Disable Unnecessary Services on Enterprise Assets and Software'
        }
      ]
    })
    expect(doc.references.find((r) => r.label === 'ANSSI 21')?.satisfied).toBe(true)
    expect(doc.references.every((r) => r.satisfied)).toBe(true)
  })
})
