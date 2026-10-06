/**
 * Accès typé aux données des rôles stockées sur un serveur (`device.roles[clé]`).
 * Le stockage est générique ; chaque module fournit sa définition (`RoleStateDef`) et ses
 * accesseurs (`dhcpServerOf`, `dnsServerOf`…). Fonctionne aussi sur un brouillon immer.
 */
import type { RoleStateDef } from './types'

/** Équipement (ou brouillon d'équipement) susceptible de porter des données de rôles. */
type MaybeServer = { kind: string; roles?: Record<string, unknown> } | null | undefined

/** Données d'un rôle sur un serveur (null : pas un serveur, ou rôle jamais installé). */
export function roleState<S>(device: MaybeServer, def: RoleStateDef<S>): S | null {
  if (!device || device.kind !== 'server' || !device.roles) return null
  return (device.roles[def.key] as S | undefined) ?? null
}

/** Données d'un rôle, créées au besoin (à utiliser sur un brouillon immer). */
export function ensureRoleState<S>(device: { roles: Record<string, unknown> }, def: RoleStateDef<S>): S {
  if (device.roles[def.key] === undefined || device.roles[def.key] === null)
    device.roles[def.key] = def.create()
  return device.roles[def.key] as S
}
