/**
 * Contrat d'une règle de l'audit de sécurité : chaque règle est déclarative (identifiant,
 * gravité, correction suggérée) et renvoie les objets du lab qui l'enfreignent. Les rôles
 * déclarent leurs règles dans leur module (`RoleModule.auditRules`).
 */
import type { LabState } from '../model/schema'

export const AUDIT_SEVERITIES = ['critique', 'élevée', 'moyenne', 'faible'] as const
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number]

/** Points retirés au score par une règle enfreinte, selon sa gravité. */
export const SEVERITY_WEIGHTS: Record<AuditSeverity, number> = {
  critique: 25,
  élevée: 15,
  moyenne: 10,
  faible: 5
}

/** Objet du lab qui enfreint une règle. */
export interface AuditFinding {
  /** Objet concerné (LAB\jdupont, SRV1 › partage Compta…). */
  object: string
  detail: string
}

export interface AuditRule {
  id: string
  title: string
  severity: AuditSeverity
  /** Correction suggérée (console et PowerShell). */
  fix: string
  check(state: LabState): AuditFinding[]
}

/** Inactivité (jours) au-delà de laquelle un compte activé est signalé. */
export const INACTIVE_DAYS = 90
/** Longueur minimale de mot de passe attendue (recommandation ANSSI : au moins 12). */
export const MIN_PASSWORD_LENGTH = 12
/** Au-delà de ce nombre de comptes, le groupe Admins du domaine est jugé trop large. */
export const MAX_DOMAIN_ADMINS = 2
