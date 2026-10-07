/**
 * Données RRAS sur un serveur : définition (registre, validation) et accesseur.
 */
import { roleState } from '../state'
import type { RoleStateDef } from '../types'
import { RrasStateSchema, type RrasState } from './schema'

export const RRAS_STATE: RoleStateDef<RrasState> = {
  key: 'rras',
  feature: 'RemoteAccess',
  schema: RrasStateSchema,
  create: () => ({ mode: null, publicIfaceId: null, pool: null, sessions: [], radius: [] })
}

export const rrasOf = (device: Parameters<typeof roleState>[0]): RrasState | null =>
  roleState(device, RRAS_STATE)

/** NAT actif (assistant NAT, ou VPN et NAT). */
export const natEnabled = (rras: RrasState | null): boolean =>
  rras?.mode === 'nat' || rras?.mode === 'vpn-nat'

/** Serveur VPN actif. */
export const vpnEnabled = (rras: RrasState | null): boolean =>
  rras?.mode === 'vpn' || rras?.mode === 'vpn-nat'
