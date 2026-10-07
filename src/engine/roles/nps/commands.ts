/**
 * Commandes du serveur NPS : actions pures du moteur + libellés français.
 */
import { def, on } from '../../commands/define'
import {
  addNetworkPolicy,
  addRadiusClient,
  moveNetworkPolicy,
  removeNetworkPolicy,
  removeRadiusClient,
  setNetworkPolicyEnabled
} from './actions'

export const npsCommands = {
  'nps.addClient': def(
    addRadiusClient,
    (s, id, input) => `Nouveau client RADIUS « ${input.name} »${on(s, id)}`
  ),
  'nps.removeClient': def(
    removeRadiusClient,
    (s, id, name) => `Supprimer le client RADIUS « ${name} »${on(s, id)}`
  ),
  'nps.addPolicy': def(
    addNetworkPolicy,
    (s, id, input) => `Nouvelle stratégie réseau « ${input.name} »${on(s, id)}`
  ),
  'nps.removePolicy': def(
    removeNetworkPolicy,
    (s, id, name) => `Supprimer la stratégie réseau « ${name} »${on(s, id)}`
  ),
  'nps.setPolicyEnabled': def(
    setNetworkPolicyEnabled,
    (s, id, name, enabled) => `${enabled ? 'Activer' : 'Désactiver'} la stratégie « ${name} »${on(s, id)}`
  ),
  'nps.movePolicy': def(
    moveNetworkPolicy,
    (s, id, name, delta) => `${delta < 0 ? 'Monter' : 'Descendre'} la stratégie « ${name} »${on(s, id)}`
  )
}
