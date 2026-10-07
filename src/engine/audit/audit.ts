/**
 * Audit de sécurité d'un lab : score sur 100 et recommandations classées par gravité.
 * Chaque règle enfreinte retire le poids de sa gravité ; la comparaison avec un audit antérieur
 * indique les recommandations corrigées depuis.
 */
import type { LabState } from '../model/schema'
import { auditRules } from './rules'
import {
  AUDIT_SEVERITIES,
  SEVERITY_WEIGHTS,
  type AuditFinding,
  type AuditRule,
  type AuditSeverity
} from './types'

export interface AuditRecommendation {
  rule: string
  title: string
  severity: AuditSeverity
  fix: string
  findings: AuditFinding[]
}

export interface AuditReport {
  /** Score de 0 à 100. */
  score: number
  /** Recommandations (règles enfreintes), de la plus grave à la moins grave. */
  recommendations: AuditRecommendation[]
  /** Identifiants des règles respectées. */
  passed: string[]
  /** Horloge du lab au moment de l'audit. */
  clock: number
}

/** Analyse le lab avec les règles données (toutes par défaut). */
export function auditLab(state: LabState, rules: AuditRule[] = auditRules()): AuditReport {
  const recommendations: AuditRecommendation[] = []
  const passed: string[] = []
  for (const rule of rules) {
    const findings = rule.check(state)
    if (findings.length === 0) passed.push(rule.id)
    else
      recommendations.push({
        rule: rule.id,
        title: rule.title,
        severity: rule.severity,
        fix: rule.fix,
        findings
      })
  }
  recommendations.sort((a, b) => AUDIT_SEVERITIES.indexOf(a.severity) - AUDIT_SEVERITIES.indexOf(b.severity))
  const penalty = recommendations.reduce((sum, r) => sum + SEVERITY_WEIGHTS[r.severity], 0)
  return { score: Math.max(0, 100 - penalty), recommendations, passed, clock: state.clock }
}

/** État d'une recommandation d'un audit de référence au regard de l'audit actuel. */
export interface AuditComparison extends AuditRecommendation {
  corrected: boolean
}

/** Recommandations de l'audit de référence, marquées corrigées si la règle est désormais respectée. */
export function compareAudits(before: AuditReport, now: AuditReport): AuditComparison[] {
  const current = new Map(now.recommendations.map((r) => [r.rule, r]))
  const previous = before.recommendations.map((r) => ({ ...r, corrected: !current.has(r.rule) }))
  // Nouvelles recommandations apparues depuis
  const added = now.recommendations
    .filter((r) => !before.recommendations.some((b) => b.rule === r.rule))
    .map((r) => ({ ...r, corrected: false }))
  return [...previous, ...added]
}
