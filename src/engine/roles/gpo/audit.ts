/**
 * Règle d'audit des stratégies de groupe : stratégie de mot de passe du domaine.
 */
import { MIN_PASSWORD_LENGTH, type AuditRule } from '../../audit/types'
import { domainPasswordPolicy } from './scope'

export const gpoAuditRules: AuditRule[] = [
  {
    id: 'weakPasswordPolicy',
    title: 'Stratégie de mot de passe faible',
    severity: 'élevée',
    fix: `Dans la Default Domain Policy, imposez au moins ${MIN_PASSWORD_LENGTH} caractères et activez la complexité.`,
    check: (state) =>
      Object.values(state.domains).flatMap((d) => {
        const policy = domainPasswordPolicy(d)
        const issues = [
          ...(policy.minLength < MIN_PASSWORD_LENGTH
            ? [`longueur minimale ${policy.minLength} (au moins ${MIN_PASSWORD_LENGTH} attendus)`]
            : []),
          ...(!policy.complexity ? ['complexité désactivée'] : [])
        ]
        return issues.length > 0
          ? [{ object: d.name, detail: `Stratégie du domaine : ${issues.join(', ')}.` }]
          : []
      })
  }
]
