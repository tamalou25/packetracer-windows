/**
 * Effets des stratégies de groupe sur le Bureau simulé : restrictions (Panneau de configuration,
 * Exécuter, invite de commandes) et lecteurs mappés de l'utilisateur de la session.
 * Les paramètres viennent du moteur (stratégie résultante appliquée sur l'ordinateur).
 */
import type { DriveMap, GpoUserSettings, HostDevice } from '@engine/index'

export const RESTRICTION_TITLE = 'Restrictions'
export const RESTRICTION_MESSAGE =
  'Cette opération a été annulée en raison de restrictions en vigueur sur cet ordinateur. Contactez votre administrateur système.'

/** Stratégie utilisateur appliquée à la session (null : aucune GPO de domaine). */
export function userPolicy(device: HostDevice): GpoUserSettings | null {
  return device.host.policy.user?.settings ?? null
}

/** L'application est-elle interdite par la stratégie de l'utilisateur ? */
export function isRestricted(device: HostDevice, app: { id: string; controlPanel?: boolean }): boolean {
  const policy = userPolicy(device)
  if (!policy) return false
  if (app.controlPanel && policy.noControlPanel === 'Enabled') return true
  return app.id === 'run' && policy.noRun === 'Enabled'
}

/** « Exécuter » retiré des menus (Supprimer le menu Exécuter du menu Démarrer). */
export function runRemoved(device: HostDevice): boolean {
  return userPolicy(device)?.noRun === 'Enabled'
}

/** Lecteurs réseau mappés par les préférences de stratégie. */
export function mappedDrives(device: HostDevice): DriveMap[] {
  return userPolicy(device)?.driveMaps ?? []
}
