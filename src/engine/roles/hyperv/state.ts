/**
 * Données du rôle Hyper-V sur un hôte : définition (registre, validation) et accesseur typé.
 */
import { roleState } from '../state'
import type { RoleStateDef } from '../types'
import { HyperVServerSchema, type HyperVServer } from './schema'

export const HYPERV_STATE: RoleStateDef<HyperVServer> = {
  key: 'hyperv',
  feature: 'Hyper-V',
  schema: HyperVServerSchema,
  create: () => ({ switches: [], vms: [] })
}

export const hyperVOf = (device: Parameters<typeof roleState>[0]): HyperVServer | null =>
  roleState(device, HYPERV_STATE)

export const VSWITCH_TYPE_LABELS = { External: 'Externe', Internal: 'Interne', Private: 'Privé' } as const
