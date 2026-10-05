/**
 * Commandes du rôle DHCP (serveur et client) : actions pures du moteur + libellés français.
 */
import { def, on } from '../../commands/define'
import { deviceName, interfaceName, scopeName } from '../../commands/labels'
import type { EngineResult } from '../../core/result'
import type { LabState } from '../../model/schema'
import { authorizeDhcpServer, completeDhcpPostInstall } from './authorization'
import { dhcpRelease, dhcpRenew, type DhcpOperation } from './client'
import {
  addExclusion,
  addReservation,
  addScope,
  removeExclusion,
  removeReservation,
  removeScope,
  setDhcpOptions,
  setScopeState
} from './server'

/** Résultat d'un renouvellement ou d'une libération de bail (l'échec est aussi journalisé). */
export type DhcpClientOutcome = Omit<DhcpOperation, 'state'>

function dhcpClient(op: DhcpOperation): EngineResult<DhcpClientOutcome> {
  const { state, ...outcome } = op
  return { ok: true, state, value: outcome }
}

/** Nouvelle étendue DHCP avec ses options (assistant « Nouvelle étendue »). */
function createScope(
  state: LabState,
  deviceId: string,
  input: Parameters<typeof addScope>[2],
  options: Parameters<typeof setDhcpOptions>[3] | null
): EngineResult<string> {
  const created = addScope(state, deviceId, input)
  if (!created.ok || !options) return created
  const configured = setDhcpOptions(created.state, deviceId, created.value, options)
  return configured.ok ? { ok: true, state: configured.state, value: created.value } : configured
}

export const dhcpCommands = {
  'net.dhcpRenew': def(
    (s: LabState, id: string, ifaceId: string) => dhcpClient(dhcpRenew(s, id, ifaceId)),
    (s, id, ifaceId) => `Renouveler le bail DHCP de ${interfaceName(s, id, ifaceId)}`
  ),
  'net.dhcpRelease': def(
    (s: LabState, id: string, ifaceId: string) => dhcpClient(dhcpRelease(s, id, ifaceId)),
    (s, id, ifaceId) => `Libérer le bail DHCP de ${interfaceName(s, id, ifaceId)}`
  ),
  'dhcp.completePostInstall': def(
    completeDhcpPostInstall,
    (s, id) => `Terminer la configuration DHCP${on(s, id)}`
  ),
  'dhcp.authorize': def(
    authorizeDhcpServer,
    (s, id, authorized) =>
      `${authorized ? 'Autoriser' : 'Retirer l’autorisation de'} ${deviceName(s, id)} dans AD`
  ),
  'dhcp.addScope': def(addScope, (s, id, input) => `Créer l’étendue ${input.name}${on(s, id)}`),
  'dhcp.createScope': def(createScope, (s, id, input) => `Créer l’étendue ${input.name}${on(s, id)}`),
  'dhcp.removeScope': def(
    removeScope,
    (s, id, scopeId) => `Supprimer l’étendue ${scopeName(s, id, scopeId)}`
  ),
  'dhcp.setScopeState': def(
    setScopeState,
    (s, id, scopeId, active) => `${active ? 'Activer' : 'Désactiver'} l’étendue ${scopeName(s, id, scopeId)}`
  ),
  'dhcp.addExclusion': def(
    addExclusion,
    (s, id, scopeId, start, end) => `Exclure ${start}–${end} de ${scopeName(s, id, scopeId)}`
  ),
  'dhcp.removeExclusion': def(
    removeExclusion,
    (s, id, scopeId) => `Supprimer une exclusion de ${scopeName(s, id, scopeId)}`
  ),
  'dhcp.addReservation': def(addReservation, (_s, _id, _scope, r) => `Réserver ${r.ip} pour ${r.name}`),
  'dhcp.removeReservation': def(
    removeReservation,
    (_s, _id, _scope, key) => `Supprimer la réservation ${key}`
  ),
  'dhcp.setOptions': def(
    setDhcpOptions,
    (s, id, scopeId) =>
      `Modifier les options DHCP ${scopeId ? `de ${scopeName(s, id, scopeId)}` : `du serveur${on(s, id)}`}`
  )
}
