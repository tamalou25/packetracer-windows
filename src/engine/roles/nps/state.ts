/**
 * Données NPS sur un serveur : définition (registre, validation) et accesseur.
 */
import { roleState } from '../state'
import type { RoleStateDef } from '../types'
import { NpsStateSchema, type NpsState } from './schema'

/** Stratégies créées avec le rôle (refus par défaut, comme les deux stratégies d'origine). */
export const DEFAULT_POLICIES: NpsState['policies'] = [
  {
    name: 'Connexions au serveur Microsoft de routage et d’accès à distance',
    enabled: true,
    groups: [],
    access: 'Deny'
  },
  { name: 'Connexions à d’autres serveurs d’accès', enabled: true, groups: [], access: 'Deny' }
]

export const NPS_STATE: RoleStateDef<NpsState> = {
  key: 'nps',
  feature: 'NPAS',
  schema: NpsStateSchema,
  create: () => ({
    radiusClients: [],
    policies: DEFAULT_POLICIES.map((p) => ({ ...p, groups: [...p.groups] }))
  })
}

export const npsOf = (device: Parameters<typeof roleState>[0]): NpsState | null =>
  roleState(device, NPS_STATE)
