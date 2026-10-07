/**
 * Commandes RRAS et client VPN : actions pures du moteur + libellés français.
 */
import { def, on } from '../../commands/define'
import type { EngineResult } from '../../core/result'
import type { LabState } from '../../model/schema'
import {
  addRadiusServer,
  configureRras,
  disableRras,
  MODE_LABELS,
  removeRadiusServer,
  setVpnPool
} from './actions'
import { addVpnConnection, removeVpnConnection, vpnConnect, vpnDisconnect } from './vpn'

/** Connexion VPN : l'échec (refus, serveur injoignable) n'est pas une erreur de commande. */
function connect(
  state: LabState,
  clientId: string,
  name: string,
  credentials: { user: string; password: string }
): EngineResult<{ ok: boolean; message: string; address: string | null }> {
  const r = vpnConnect(state, clientId, name, credentials)
  return { ok: true, state: r.state, value: { ok: r.ok, message: r.message, address: r.address } }
}

export const rrasCommands = {
  'rras.configure': def(
    configureRras,
    (s, id, input) => `Configurer le routage et l’accès distant : ${MODE_LABELS[input.mode]}${on(s, id)}`
  ),
  'rras.disable': def(disableRras, (s, id) => `Désactiver le routage et l’accès distant${on(s, id)}`),
  'rras.setPool': def(setVpnPool, (s, id, pool) => `Pool VPN ${pool.start} – ${pool.end}${on(s, id)}`),
  'rras.addRadius': def(
    addRadiusServer,
    (s, id, input) => `Ajouter le serveur RADIUS ${input.server}${on(s, id)}`
  ),
  'rras.removeRadius': def(
    removeRadiusServer,
    (s, id, server) => `Retirer le serveur RADIUS ${server}${on(s, id)}`
  ),
  'vpn.addConnection': def(
    addVpnConnection,
    (s, id, input) => `Ajouter la connexion VPN « ${input.name} »${on(s, id)}`
  ),
  'vpn.removeConnection': def(
    removeVpnConnection,
    (s, id, name) => `Supprimer la connexion VPN « ${name} »${on(s, id)}`
  ),
  'vpn.connect': def(connect, (s, id, name) => `Se connecter au VPN « ${name} »${on(s, id)}`),
  'vpn.disconnect': def(vpnDisconnect, (s, id, name) => `Déconnecter le VPN « ${name} »${on(s, id)}`)
}
