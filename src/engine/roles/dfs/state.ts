/**
 * Données du rôle DFS sur un serveur : définition (registre, validation) et accesseurs.
 */
import type { LabState, ServerDevice } from '../../model/schema'
import { roleState } from '../state'
import type { RoleStateDef } from '../types'
import { DfsServerSchema, type DfsServer, type Namespace } from './schema'

export const DFS_STATE: RoleStateDef<DfsServer> = {
  key: 'dfs',
  feature: 'FS-DFS-Namespace',
  schema: DfsServerSchema,
  create: () => ({ namespaces: [], groups: [] })
}

export const dfsOf = (device: Parameters<typeof roleState>[0]): DfsServer | null =>
  roleState(device, DFS_STATE)

/** Espace de noms de domaine \\<domaine>\<nom> et son serveur d'espace de noms. */
export function findNamespace(
  state: LabState,
  domainName: string,
  name: string
): { server: ServerDevice; namespace: Namespace } | null {
  const lowerDomain = domainName.toLowerCase()
  const lower = name.toLowerCase()
  for (const d of Object.values(state.devices)) {
    if (d.kind !== 'server' || !d.host.domain) continue
    const domain = state.domains[d.host.domain]
    if (!domain || (domain.name !== lowerDomain && domain.netbios.toLowerCase() !== lowerDomain)) continue
    const namespace = dfsOf(d)?.namespaces.find((n) => n.name.toLowerCase() === lower)
    if (namespace) return { server: d, namespace }
  }
  return null
}
