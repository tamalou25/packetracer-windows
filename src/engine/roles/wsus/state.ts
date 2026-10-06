/**
 * Données du rôle WSUS sur un serveur : définition (registre, validation) et accesseur typé.
 */
import { roleState } from '../state'
import type { RoleStateDef } from '../types'
import { WsusServerSchema, type WsusServer } from './schema'

/** Groupes intégrés : racine et groupe par défaut des nouveaux ordinateurs. */
export const ALL_COMPUTERS = 'Tous les ordinateurs'
export const UNASSIGNED_COMPUTERS = 'Ordinateurs non attribués'

/** Serveur WSUS tel qu'après l'installation du rôle (post-installation à faire). */
export function createWsusServer(): WsusServer {
  return {
    configured: false,
    contentDir: '',
    classifications: ['critical', 'security'],
    lastSync: null,
    updates: [],
    targeting: 'server',
    groups: [],
    assignments: [],
    approvals: [],
    declined: []
  }
}

export const WSUS_STATE: RoleStateDef<WsusServer> = {
  key: 'wsus',
  feature: 'UpdateServices',
  schema: WsusServerSchema,
  create: createWsusServer
}

/** Données WSUS d'un équipement (null si ce n'est pas un serveur WSUS). */
export const wsusServerOf = (device: Parameters<typeof roleState>[0]): WsusServer | null =>
  roleState(device, WSUS_STATE)

/** Tous les groupes d'ordinateurs, dans l'ordre de la console. */
export function wsusGroups(wsus: WsusServer): string[] {
  return [ALL_COMPUTERS, UNASSIGNED_COMPUTERS, ...wsus.groups]
}

/** Nom exact d'un groupe existant (comparaison insensible à la casse), sinon null. */
export function findWsusGroup(wsus: WsusServer, name: string): string | null {
  const lower = name.trim().toLowerCase()
  return wsusGroups(wsus).find((g) => g.toLowerCase() === lower) ?? null
}
