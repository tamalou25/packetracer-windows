/**
 * Données du rôle RDS sur un serveur : définition (registre, validation) et accesseur typé.
 */
import { roleState } from '../state'
import type { RoleStateDef } from '../types'
import { RdsServerSchema, type RdsServer } from './schema'

export const RDS_STATE: RoleStateDef<RdsServer> = {
  key: 'rds',
  feature: 'RDS-RD-Server',
  schema: RdsServerSchema,
  create: () => ({ collections: [] })
}

export const rdsServerOf = (device: Parameters<typeof roleState>[0]): RdsServer | null =>
  roleState(device, RDS_STATE)

/** Port TCP du protocole Bureau à distance. */
export const RDP_PORT = 3389
