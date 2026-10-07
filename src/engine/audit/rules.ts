/**
 * Règles d'audit du système de base (pare-feu) et liste complète : système de base puis
 * règles déclarées par les modules de rôles.
 */
import type { HostDevice, LabState } from '../model/schema'
import { FIREWALL_PROFILES } from '../model/schema'
import { roleModules } from '../roles/registry'
import { PROFILE_LABELS, profileEnabled } from '../services/firewall'
import type { AuditRule } from './types'

export * from './types'

/** Ordinateurs Windows (le pare-feu Windows ne concerne pas les postes Linux). */
const hosts = (state: LabState): HostDevice[] =>
  Object.values(state.devices).filter(
    (d): d is HostDevice => (d.kind === 'server' || d.kind === 'client') && d.host.os !== 'linux'
  )

/** Règles du système de base. */
export const CORE_AUDIT_RULES: AuditRule[] = [
  {
    id: 'firewallDisabled',
    title: 'Pare-feu désactivé',
    severity: 'élevée',
    fix: 'Réactivez le pare-feu sur tous les profils (Set-NetFirewallProfile -All -Enabled True) ou par stratégie de groupe.',
    check: (state) =>
      hosts(state).flatMap((h) =>
        FIREWALL_PROFILES.filter((p) => !profileEnabled(h, p)).map((p) => ({
          object: `${h.name} (profil ${PROFILE_LABELS[p]})`,
          detail: `Le pare-feu est désactivé pour le profil ${PROFILE_LABELS[p]}.`
        }))
      )
  }
]

/** Toutes les règles : système de base puis rôles, dans l'ordre du registre. */
export function auditRules(): AuditRule[] {
  return [...CORE_AUDIT_RULES, ...roleModules().flatMap((m) => m.auditRules ?? [])]
}
