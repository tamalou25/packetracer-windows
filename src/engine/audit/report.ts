/**
 * Rapport d'audit : contenu exportable (lab, date, score, recommandations) avec l'état de chaque
 * recommandation au regard d'un audit de référence (départ du lab ou ouverture du document).
 * La mise en page (HTML puis PDF) est faite hors du moteur.
 */
import type { AuditFinding, AuditSeverity } from './types'
import { compareAudits, type AuditReport } from './audit'

export type AuditItemStatus = 'corrigé' | 'non corrigé'

export interface AuditReportItem {
  rule: string
  title: string
  severity: AuditSeverity
  fix: string
  status: AuditItemStatus
  /** Recommandation apparue depuis la référence. */
  added: boolean
  /** Objets en cause : actuels si non corrigée, relevés dans la référence si corrigée. */
  findings: AuditFinding[]
}

export interface AuditReportDocument {
  /** Nom du lab ou du document. */
  lab: string
  /** Date de l'export, déjà mise en forme (le moteur ne lit pas l'heure système). */
  date: string
  score: number
  /** Score de l'audit de référence, null sans référence. */
  baselineScore: number | null
  /** Recommandations : non corrigées d'abord (par gravité), puis corrigées. */
  items: AuditReportItem[]
  corrected: number
  remaining: number
  /** Nombre de règles respectées. */
  passed: number
}

/**
 * Construit le rapport. Sans référence, chaque recommandation actuelle est « non corrigé » ;
 * avec une référence, les recommandations disparues depuis sont « corrigé ».
 */
export function buildAuditReport(input: {
  lab: string
  date: string
  current: AuditReport
  baseline: AuditReport | null
}): AuditReportDocument {
  const { current, baseline } = input
  const compared = compareAudits(baseline ?? current, current)
  const known = new Set((baseline ?? current).recommendations.map((r) => r.rule))
  const items: AuditReportItem[] = compared.map((c) => ({
    rule: c.rule,
    title: c.title,
    severity: c.severity,
    fix: c.fix,
    status: c.corrected ? 'corrigé' : 'non corrigé',
    added: !known.has(c.rule),
    // Non corrigée : objets actuels (ils ont pu changer depuis la référence)
    findings: c.corrected
      ? c.findings
      : (current.recommendations.find((r) => r.rule === c.rule)?.findings ?? c.findings)
  }))
  // Ordre : non corrigées puis corrigées, chacune par gravité (ordre de compareAudits conservé)
  const ordered = [
    ...items.filter((i) => i.status === 'non corrigé'),
    ...items.filter((i) => i.status === 'corrigé')
  ]
  const corrected = ordered.filter((i) => i.status === 'corrigé').length
  return {
    lab: input.lab,
    date: input.date,
    score: current.score,
    baselineScore: baseline ? baseline.score : null,
    items: ordered,
    corrected,
    remaining: ordered.length - corrected,
    passed: current.passed.length
  }
}
