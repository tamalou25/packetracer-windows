/**
 * Rapport d'audit : état corrigé / non corrigé au regard de la référence, ordre, compteurs.
 */
import { describe, expect, it } from 'vitest'
import {
  auditLab,
  buildAuditReport,
  command,
  DEFAULT_DOMAIN_POLICY_ID,
  dispatch,
  type LabState
} from '@engine/index'
import { buildReferenceLab } from '../serialization/reference-lab'
import { run } from '../shell/helpers'

const D = 'lab.local'
const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''
const ps = (s: LabState, line: string) => run(s, id(s, 'SRV1'), line).state

function policy(s: LabState, minPasswordLength: number): LabState {
  const r = dispatch(
    s,
    command('gpo.updateSettings', D, DEFAULT_DOMAIN_POLICY_ID, {
      computer: { minPasswordLength, passwordComplexity: true }
    })
  )
  if (!r.ok) throw new Error(r.error.message)
  return r.state
}

/** Référence : SMB 1.0 activé (critique) et pare-feu désactivé (élevée), mot de passe conforme. */
function baselineLab(): LabState {
  let s = policy(buildReferenceLab(), 12)
  s = ps(s, 'Set-SmbServerConfiguration -EnableSMB1Protocol $true -Force')
  return ps(s, 'Set-NetFirewallProfile -All -Enabled False')
}

describe('Rapport d’audit', () => {
  it('sans référence : toutes les recommandations actuelles sont non corrigées', () => {
    const current = auditLab(baselineLab())
    const doc = buildAuditReport({ lab: 'Lab 19', date: '07/10/2026 14:00', current, baseline: null })
    expect(doc).toMatchObject({ lab: 'Lab 19', date: '07/10/2026 14:00', baselineScore: null })
    expect(doc.score).toBe(current.score)
    expect(doc.items.map((i) => [i.rule, i.status, i.added])).toEqual([
      ['smb1', 'non corrigé', false],
      ['firewallDisabled', 'non corrigé', false]
    ])
    expect(doc.corrected).toBe(0)
    expect(doc.remaining).toBe(2)
    expect(doc.passed).toBe(current.passed.length)
  })

  it('avec référence : corrigées, restantes et nouvelles, non corrigées en tête', () => {
    const start = baselineLab()
    const baseline = auditLab(start)
    // SMB 1.0 désactivé (corrigé), pare-feu toujours coupé, stratégie de mot de passe affaiblie (nouvelle)
    let s = ps(start, 'Set-SmbServerConfiguration -EnableSMB1Protocol $false -Force')
    s = policy(s, 8)
    const current = auditLab(s)
    const doc = buildAuditReport({ lab: 'Lab', date: 'd', current, baseline })
    expect(doc.items.map((i) => [i.rule, i.status, i.added])).toEqual([
      ['firewallDisabled', 'non corrigé', false],
      ['weakPasswordPolicy', 'non corrigé', true],
      ['smb1', 'corrigé', false]
    ])
    expect(doc.baselineScore).toBe(baseline.score)
    expect(doc.score).toBe(current.score)
    expect(doc.corrected).toBe(1)
    expect(doc.remaining).toBe(2)
    // Corrigée : objets relevés dans la référence
    expect(doc.items.find((i) => i.rule === 'smb1')?.findings).toEqual(
      baseline.recommendations.find((r) => r.rule === 'smb1')?.findings
    )
  })

  it('non corrigée : objets en cause actuels, pas ceux de la référence', () => {
    const start = baselineLab()
    const baseline = auditLab(start)
    // Pare-feu réactivé sur le seul profil Domaine : la recommandation reste, avec moins d'objets
    const s = ps(start, 'Set-NetFirewallProfile -Profile Domain -Enabled True')
    const current = auditLab(s)
    const doc = buildAuditReport({ lab: 'Lab', date: 'd', current, baseline })
    const firewall = doc.items.find((i) => i.rule === 'firewallDisabled')!
    expect(firewall.status).toBe('non corrigé')
    expect(firewall.findings).toEqual(
      current.recommendations.find((r) => r.rule === 'firewallDisabled')?.findings
    )
    expect(firewall.findings.length).toBeLessThan(
      baseline.recommendations.find((r) => r.rule === 'firewallDisabled')!.findings.length
    )
  })

  it('tout corrigé : aucune restante, score 100', () => {
    const start = baselineLab()
    const baseline = auditLab(start)
    let s = ps(start, 'Set-SmbServerConfiguration -EnableSMB1Protocol $false -Force')
    s = ps(s, 'Set-NetFirewallProfile -All -Enabled True')
    const doc = buildAuditReport({ lab: 'Lab', date: 'd', current: auditLab(s), baseline })
    expect(doc.score).toBe(100)
    expect(doc.remaining).toBe(0)
    expect(doc.items.every((i) => i.status === 'corrigé')).toBe(true)
  })
})
