/**
 * Commandes du rôle RDS et du Bureau à distance : actions pures du moteur + libellés français.
 */
import { def, on } from '../../commands/define'
import { deviceName } from '../../commands/labels'
import type { EngineResult } from '../../core/result'
import type { LabState } from '../../model/schema'
import { rdpConnect, rdpDisconnect, type RdpInput } from './connect'
import {
  addRemoteApp,
  addSessionCollection,
  removeRemoteApp,
  removeSessionCollection,
  setCollectionUserGroups,
  setRemoteDesktop
} from './server'

/** Connexion Bureau à distance : l'échec (journalisé sur l'ordinateur distant) n'est pas une erreur. */
function connect(
  state: LabState,
  clientId: string,
  input: RdpInput
): EngineResult<{ ok: boolean; message: string; sessionId: number | null }> {
  const r = rdpConnect(state, clientId, input)
  return { ok: true, state: r.state, value: { ok: r.ok, message: r.message, sessionId: r.sessionId ?? null } }
}

export const rdsCommands = {
  'rds.setRemoteDesktop': def(setRemoteDesktop, (s, id, settings) =>
    settings.enabled === false
      ? `Interdire les connexions Bureau à distance${on(s, id)}`
      : `Paramètres Bureau à distance${on(s, id)}`
  ),
  'rds.addCollection': def(
    addSessionCollection,
    (s, id, input) => `Créer la collection ${input.name}${on(s, id)}`
  ),
  'rds.removeCollection': def(removeSessionCollection, (_s, _id, name) => `Supprimer la collection ${name}`),
  'rds.setCollectionUserGroups': def(
    setCollectionUserGroups,
    (_s, _id, name, groups) => `Groupes d’utilisateurs de la collection ${name} : ${groups.join(', ')}`
  ),
  'rds.addRemoteApp': def(
    addRemoteApp,
    (_s, _id, collection, app) => `Publier le programme RemoteApp ${app.displayName} (${collection})`
  ),
  'rds.removeRemoteApp': def(
    removeRemoteApp,
    (_s, _id, collection, alias) => `Retirer le programme RemoteApp ${alias} (${collection})`
  ),
  'rds.connect': def(
    connect,
    (s, id, input) => `Connexion Bureau à distance de ${deviceName(s, id)} vers ${input.computer}`
  ),
  'rds.disconnect': def(rdpDisconnect, (s, id) => `Fermer une session Bureau à distance${on(s, id)}`)
}
