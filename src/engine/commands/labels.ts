/**
 * Noms lisibles des objets du lab pour les libellés de commandes (« Renommer SRV1 en DC1 »).
 * Un objet introuvable (déjà supprimé) est désigné par son identifiant.
 */
import type { LabState } from '../model/schema'

export function deviceName(state: LabState, id: string): string {
  return state.devices[id]?.name ?? id
}

export function deviceNames(state: LabState, ids: string[]): string {
  const names = ids.map((id) => deviceName(state, id))
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')}… (${names.length})`
}

export function interfaceName(state: LabState, deviceId: string, ifaceId: string): string {
  const iface = state.devices[deviceId]?.interfaces.find((i) => i.id === ifaceId)
  return `${deviceName(state, deviceId)} ${iface?.name ?? ifaceId}`
}

export function linkName(state: LabState, linkId: string): string {
  const link = state.links[linkId]
  if (!link) return linkId
  return `${interfaceName(state, link.a.deviceId, link.a.ifaceId)} ↔ ${interfaceName(state, link.b.deviceId, link.b.ifaceId)}`
}

export function gpoName(state: LabState, domainName: string, gpoId: string): string {
  return state.domains[domainName]?.gpos.find((g) => g.id === gpoId)?.name ?? gpoId
}

export function scopeName(state: LabState, deviceId: string, scopeId: string): string {
  const device = state.devices[deviceId]
  const scope =
    device?.kind === 'server' ? device.services.dhcp?.scopes.find((s) => s.scopeId === scopeId) : undefined
  return scope ? `${scope.name} (${scope.scopeId})` : scopeId
}

/** Objet de l'annuaire (OU, utilisateur, groupe, ordinateur) désigné par son identifiant. */
export function directoryObjectName(state: LabState, domainName: string, objectId: string): string {
  const domain = state.domains[domainName]
  if (!domain) return objectId
  const found =
    domain.containers.find((c) => c.id === objectId) ??
    domain.users.find((u) => u.id === objectId) ??
    domain.groups.find((g) => g.id === objectId) ??
    domain.computers.find((c) => c.id === objectId)
  return found?.name ?? objectId
}

/** Cible d'une liaison de GPO : OU désignée par son identifiant, ou racine du domaine (null). */
export function linkTargetName(state: LabState, domainName: string, targetId: string | null): string {
  return targetId === null ? domainName : directoryObjectName(state, domainName, targetId)
}
