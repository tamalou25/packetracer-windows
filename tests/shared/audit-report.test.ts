/**
 * Rapport d'audit PDF : validation du contenu reçu du renderer, nom de fichier proposé et page
 * HTML imprimée (échappement, contenu, aucune ressource externe ni script).
 */
import { describe, expect, it } from 'vitest'
import {
  auditReportFileName,
  escapeHtml,
  parseAuditReport,
  renderAuditReportHtml,
  type AuditReportData
} from '../../src/shared/auditReport'

const report: AuditReportData = {
  lab: 'Durcissement AD',
  date: '7 octobre 2026 à 14:05',
  score: 85,
  baselineScore: 45,
  items: [
    {
      rule: 'firewallDisabled',
      title: 'Pare-feu désactivé',
      severity: 'élevée',
      fix: 'Réactivez le pare-feu.',
      status: 'non corrigé',
      added: false,
      findings: [{ object: 'SRV1 (profil Public)', detail: 'Le pare-feu est désactivé.' }]
    },
    {
      rule: 'smb1',
      title: 'SMB 1.0 activé',
      severity: 'critique',
      fix: 'Désactivez SMB 1.0.',
      status: 'corrigé',
      added: false,
      findings: [{ object: 'SRV1', detail: 'SMB 1.0 est activé.' }]
    }
  ],
  corrected: 1,
  remaining: 1,
  passed: 6
}

describe('rapport d’audit exporté', () => {
  it('contenu valide accepté, contenu aberrant refusé', () => {
    expect(parseAuditReport(report)).toEqual(report)
    expect(parseAuditReport({ ...report, score: 120 })).toBeNull()
    expect(parseAuditReport({ ...report, items: [{ ...report.items[0], severity: 'urgente' }] })).toBeNull()
    expect(parseAuditReport({ ...report, lab: 'x'.repeat(500) })).toBeNull()
    expect(parseAuditReport('rapport')).toBeNull()
    expect(parseAuditReport(null)).toBeNull()
  })

  it('nom de fichier proposé sans caractère interdit', () => {
    expect(auditReportFileName('Lab 19 : durcissement/AD')).toBe(
      'Rapport d’audit - Lab 19   durcissement AD.pdf'
    )
    expect(auditReportFileName('')).toBe('Rapport d’audit - Sans titre.pdf')
    expect(auditReportFileName(42)).toBe('Rapport d’audit - Sans titre.pdf')
    expect(auditReportFileName('Lab\u0007\n')).toBe('Rapport d’audit - Lab.pdf')
  })

  it('page HTML : lab, date, score, référence, états corrigé / non corrigé', () => {
    const html = renderAuditReportHtml(report)
    expect(html).toContain('Durcissement AD')
    expect(html).toContain('7 octobre 2026 à 14:05')
    expect(html).toContain('85 / 100')
    expect(html).toContain('référence : 45 / 100')
    expect(html).toContain('1 recommandation(s) corrigée(s), 1 non corrigée(s), 6 règle(s) respectée(s)')
    expect(html).toContain('Non corrigé')
    expect(html).toContain('Corrigé')
    expect(html).toContain('SRV1 (profil Public)')
    // Sans référence : pas de score de référence
    expect(renderAuditReportHtml({ ...report, baselineScore: null })).not.toContain('référence :')
  })

  it('texte du lab échappé ; ni script ni ressource externe', () => {
    const html = renderAuditReportHtml({
      ...report,
      lab: '<script>alert(1)</script>',
      items: [{ ...report.items[0]!, findings: [{ object: '<img src=x>', detail: '"&\'' }] }]
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&quot;&amp;&#39;')
    expect(html).toContain("default-src 'none'")
    expect(html).not.toMatch(/https?:\/\//)
    expect(escapeHtml('a<b>&"\'')).toBe('a&lt;b&gt;&amp;&quot;&#39;')
  })

  it('aucune recommandation : message explicite', () => {
    const html = renderAuditReportHtml({ ...report, items: [], corrected: 0, remaining: 0 })
    expect(html).toContain('toutes les règles de l’audit sont respectées')
  })
})
