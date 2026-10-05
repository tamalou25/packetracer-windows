/**
 * Aides côté interface pour l'annuaire : droits de la session, opérations réseau (jonction, connexion).
 */
import {
  isDomainAdmin,
  type Command,
  type DirectoryOutcome,
  type HostDevice,
  type LabState
} from '@engine/index'
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

type DirectoryCommand = Command<
  'adds.logon' | 'adds.changePasswordAndLogon' | 'adds.joinDomain' | 'adds.leaveDomain'
>

/**
 * Exécute une commande d'annuaire tracée (jonction, ouverture de session) : les échanges sont
 * rejoués en mode Simulation, puis la commande est validée et son issue transmise à `onDone`.
 */
export function runDirectoryCommand(
  cmd: DirectoryCommand,
  onDone: (outcome: DirectoryOutcome) => void
): void {
  const prepared = useLabStore.getState().prepare(cmd)
  const result = prepared.result
  if (!result.ok) {
    useUiStore.getState().notify('error', result.error.message)
    return
  }
  const outcome = result.value as DirectoryOutcome
  runNetworkOperation(outcome.trace, () => {
    useLabStore.getState().commit(prepared)
    onDone(outcome)
  })
}
