/**
 * Aides côté interface pour l'annuaire : droits de la session, opérations réseau (jonction, connexion).
 */
import { isDomainAdmin, type HostDevice, type LabState, type PacketTrace } from '@engine/index'
import { useLabStore } from '../store/lab'
import { useUiStore } from '../store/ui'
import { runNetworkOperation } from './network'

/** Vrai si l'utilisateur connecté sur l'ordinateur peut administrer le domaine. */
export function canAdminister(lab: LabState, device: HostDevice): boolean {
  const session = device.host.session
  const domain = device.host.domain ? lab.domains[device.host.domain] : undefined
  return !!session?.domain && !!domain && isDomainAdmin(domain, session.user)
}

/** Garde : notifie « Accès refusé » si la session n'est pas administrateur du domaine. */
export function requireAdmin(device: HostDevice): boolean {
  if (canAdminister(useLabStore.getState().lab, device)) return true
  useUiStore
    .getState()
    .notify('error', 'Accès refusé : ouvrez une session avec un compte membre des Admins du domaine.')
  return false
}

/** Applique une opération d'annuaire tracée (jonction, ouverture de session). */
export function runDirectoryOperation(op: { state: LabState; trace: PacketTrace }, onDone: () => void): void {
  runNetworkOperation(op.trace, () => {
    useLabStore.getState().run(() => ({ ok: true, state: op.state, value: undefined }))
    onDone()
  })
}
