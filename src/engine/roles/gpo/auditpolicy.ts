/**
 * Stratégie d'audit effective d'un ordinateur (paramètres d'ordinateur appliqués par les GPO) :
 * conditionne l'inscription des événements de connexion et de gestion des comptes dans son
 * journal Sécurité.
 */
import type { Draft } from 'immer'
import { logEvent, type NewEvent } from '../../core/eventlog'
import type { AuditSetting, Device, LabState } from '../../model/schema'

export type AuditCategory = 'logon' | 'accountManagement'
export type AuditOutcome = 'success' | 'failure'

/** Comportement sans GPO : connexions (succès et échecs), gestion des comptes (succès). */
const DEFAULTS: Record<AuditCategory, AuditSetting> = {
  logon: 'SuccessAndFailure',
  accountManagement: 'Success'
}

/** Paramètre d'audit effectif de l'ordinateur pour une catégorie. */
export function auditSetting(device: Device | undefined, category: AuditCategory): AuditSetting {
  const settings =
    device && (device.kind === 'server' || device.kind === 'client')
      ? device.host.policy.computer?.settings
      : undefined
  const value = category === 'logon' ? settings?.auditLogon : settings?.auditAccountManagement
  return value ?? DEFAULTS[category]
}

/** L'ordinateur audite-t-il ce type d'événement ? */
export function audits(device: Device | undefined, category: AuditCategory, outcome: AuditOutcome): boolean {
  const setting = auditSetting(device, category)
  return (
    setting === 'SuccessAndFailure' ||
    (setting === 'Success' && outcome === 'success') ||
    (setting === 'Failure' && outcome === 'failure')
  )
}

/**
 * Inscrit un événement de sécurité si la stratégie d'audit de l'ordinateur le prévoit
 * (sinon, rien n'est journalisé, comme sur un vrai serveur).
 */
export function logAudited(
  draft: Draft<LabState>,
  deviceId: string,
  category: AuditCategory,
  outcome: AuditOutcome,
  event: NewEvent
): void {
  if (audits(draft.devices[deviceId] as Device | undefined, category, outcome))
    logEvent(draft, deviceId, event)
}
