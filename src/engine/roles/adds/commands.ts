/**
 * Commandes du rôle AD DS (annuaire, jonction, sessions) : actions pures du moteur + libellés.
 */
import { def, on } from '../../commands/define'
import { deviceName, directoryObjectName } from '../../commands/labels'
import { fail, type EngineResult } from '../../core/result'
import type { LabState } from '../../model/schema'
import type { PacketTrace } from '../../sim/trace'
import { installForest } from './forest'
import {
  changePasswordAndLogon,
  joinDomain,
  leaveDomain,
  logoff,
  logon,
  type DirectoryOperation,
  type LogonOutcome
} from './join'
import {
  addGroup,
  addGroupMembers,
  addOrganizationalUnit,
  addUser,
  moveObject,
  removeGroupMembers,
  removeObject,
  resetPassword,
  setAccountEnabled
} from './objects'

/** Résultat métier d'une opération d'annuaire (jonction, ouverture de session…). */
export interface DirectoryOutcome {
  /** L'opération a abouti (un échec est aussi journalisé : évènement 4625, trace réseau). */
  success: boolean
  message: string
  trace: PacketTrace
  mustChangePassword: boolean
}

/** Une opération d'annuaire modifie l'état même en cas d'échec (journal de sécurité, trace). */
function directory(op: DirectoryOperation | LogonOutcome): EngineResult<DirectoryOutcome> {
  return {
    ok: true,
    state: op.state,
    value: {
      success: op.ok,
      message: op.message,
      trace: op.trace,
      mustChangePassword: 'mustChangePassword' in op ? op.mustChangePassword === true : false
    }
  }
}

/** Fermeture de session (l'action renvoie directement l'état). */
function closeSession(state: LabState, deviceId: string): EngineResult {
  if (!state.devices[deviceId]) return fail('DeviceNotFound', 'Équipement introuvable.')
  return { ok: true, state: logoff(state, deviceId), value: undefined }
}

export const addsCommands = {
  'adds.installForest': def(
    installForest,
    (s, id, f) => `Promouvoir ${deviceName(s, id)} (forêt ${f.domainName})`
  ),
  'adds.addOrganizationalUnit': def(
    addOrganizationalUnit,
    (_s, _d, ou) => `Créer l’unité d’organisation ${ou.name}`
  ),
  'adds.addUser': def(addUser, (_s, _d, u) => `Créer l’utilisateur ${u.name}`),
  'adds.addGroup': def(addGroup, (_s, _d, g) => `Créer le groupe ${g.name}`),
  'adds.addGroupMembers': def(addGroupMembers, (_s, _d, group) => `Ajouter des membres au groupe ${group}`),
  'adds.removeGroupMembers': def(
    removeGroupMembers,
    (_s, _d, group) => `Retirer des membres du groupe ${group}`
  ),
  'adds.moveObject': def(moveObject, (s, d, id) => `Déplacer ${directoryObjectName(s, d, id)}`),
  'adds.removeObject': def(removeObject, (s, d, id) => `Supprimer ${directoryObjectName(s, d, id)}`),
  'adds.setAccountEnabled': def(
    setAccountEnabled,
    (_s, _d, identity, enabled) => `${enabled ? 'Activer' : 'Désactiver'} le compte ${identity}`
  ),
  'adds.resetPassword': def(
    resetPassword,
    (_s, _d, identity) => `Réinitialiser le mot de passe de ${identity}`
  ),
  'adds.joinDomain': def(
    (s: LabState, id: string, input: Parameters<typeof joinDomain>[2]) => directory(joinDomain(s, id, input)),
    (s, id, input) => `Joindre ${deviceName(s, id)} au domaine ${input.domain}`
  ),
  'adds.leaveDomain': def(
    (s: LabState, id: string) => directory(leaveDomain(s, id)),
    (s, id) => `Retirer ${deviceName(s, id)} du domaine`
  ),
  'adds.logon': def(
    (s: LabState, id: string, input: Parameters<typeof logon>[2]) => directory(logon(s, id, input)),
    (s, id, input) => `Ouvrir une session ${input.user}${on(s, id)}`
  ),
  'adds.changePasswordAndLogon': def(
    (s: LabState, id: string, input: Parameters<typeof changePasswordAndLogon>[2]) =>
      directory(changePasswordAndLogon(s, id, input)),
    (s, id, input) => `Changer le mot de passe de ${input.user}${on(s, id)}`
  ),
  'adds.logoff': def(closeSession, (s, id) => `Fermer la session${on(s, id)}`)
}
