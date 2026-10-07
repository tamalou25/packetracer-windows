/**
 * Serveur NPS (console nps.msc, cmdlets NPS) : clients RADIUS, stratégies réseau (condition
 * « Groupes Windows », accès accordé ou refusé, ordre de traitement).
 */
import type { Draft } from 'immer'
import { raise, transact, type EngineResult } from '../../core/result'
import type { Domain, LabState, ServerDevice } from '../../model/schema'
import { isIpv4 } from '../../net/ipv4'
import { requireDevice } from '../../topology/actions'
import { findGroupByName } from '../adds/directory'
import { ensureRoleState } from '../state'
import type { NetworkPolicy, NpsState, RadiusClient } from './schema'
import { NPS_STATE } from './state'

function requireNps(draft: Draft<LabState>, deviceId: string): Draft<NpsState> {
  const server = requireDevice(draft, deviceId)
  if (server.kind !== 'server' || !server.host.features.includes('NPAS'))
    raise(
      'NpsNotInstalled',
      'Le rôle Services de stratégie et d’accès réseau n’est pas installé sur cet ordinateur.'
    )
  return ensureRoleState(server as Draft<ServerDevice>, NPS_STATE)
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Nouveau client RADIUS (nom convivial, adresse, secret partagé). */
export function addRadiusClient(state: LabState, serverId: string, input: RadiusClient): EngineResult {
  return transact(state, (draft) => {
    const nps = requireNps(draft, serverId)
    const name = input.name.trim()
    const address = input.address.trim()
    if (!name) raise('InvalidName', 'Indiquez un nom convivial pour le client RADIUS.')
    if (!isIpv4(address)) raise('InvalidAddress', 'Indiquez l’adresse IPv4 du client RADIUS.')
    if (!input.sharedSecret) raise('InvalidSecret', 'Indiquez le secret partagé du client RADIUS.')
    if (nps.radiusClients.some((c) => same(c.name, name)))
      raise('RadiusClientExists', `Un client RADIUS nommé « ${name} » existe déjà.`)
    if (nps.radiusClients.some((c) => c.address === address))
      raise('RadiusClientExists', `Un client RADIUS utilise déjà l’adresse ${address}.`)
    nps.radiusClients.push({ name, address, sharedSecret: input.sharedSecret })
    return undefined
  })
}

/** Supprime un client RADIUS. */
export function removeRadiusClient(state: LabState, serverId: string, name: string): EngineResult {
  return transact(state, (draft) => {
    const nps = requireNps(draft, serverId)
    const index = nps.radiusClients.findIndex((c) => same(c.name, name))
    if (index < 0) raise('RadiusClientNotFound', `Le client RADIUS « ${name} » est introuvable.`)
    nps.radiusClients.splice(index, 1)
    return undefined
  })
}

export interface NetworkPolicyInput {
  name: string
  /** Groupes du domaine (nom ou DOMAINE\nom) de la condition « Groupes Windows ». */
  groups: string[]
  access: NetworkPolicy['access']
}

/** Groupe du domaine désigné par « nom » ou « DOMAINE\nom ». */
function resolveGroup(domain: Domain, text: string) {
  const raw = text.trim()
  const [prefix, name] = raw.includes('\\') ? raw.split('\\') : [null, raw]
  if (prefix && !same(prefix, domain.netbios) && !same(prefix, domain.name)) return undefined
  return findGroupByName(domain, name ?? '')
}

/**
 * Nouvelle stratégie réseau : placée en tête de l'ordre de traitement, comme celles créées par
 * l'assistant de la console.
 */
export function addNetworkPolicy(state: LabState, serverId: string, input: NetworkPolicyInput): EngineResult {
  return transact(state, (draft) => {
    const nps = requireNps(draft, serverId)
    const server = draft.devices[serverId] as Draft<ServerDevice>
    const name = input.name.trim()
    if (!name) raise('InvalidName', 'Indiquez le nom de la stratégie réseau.')
    if (nps.policies.some((p) => same(p.name, name)))
      raise('PolicyExists', `Une stratégie réseau nommée « ${name} » existe déjà.`)
    if (input.access !== 'Grant' && input.access !== 'Deny') raise('InvalidAccess', 'Autorisation inconnue.')
    const names = input.groups.map((g) => g.trim()).filter(Boolean)
    if (names.length === 0) raise('ConditionRequired', 'Ajoutez au moins une condition « Groupes Windows ».')
    const domain = server.host.domain ? draft.domains[server.host.domain] : undefined
    if (!domain)
      raise(
        'NotDomainMember',
        'La condition « Groupes Windows » nécessite que le serveur NPS soit membre d’un domaine.'
      )
    const groups = names.map((g) => {
      const group = resolveGroup(domain, g)
      if (!group) raise('GroupNotFound', `Le groupe « ${g} » est introuvable dans le domaine ${domain.name}.`)
      return group.id
    })
    nps.policies.unshift({ name, enabled: true, groups, access: input.access })
    return undefined
  })
}

function requirePolicy(nps: Draft<NpsState>, name: string): number {
  const index = nps.policies.findIndex((p) => same(p.name, name))
  if (index < 0) raise('PolicyNotFound', `La stratégie réseau « ${name} » est introuvable.`)
  return index
}

/** Supprime une stratégie réseau. */
export function removeNetworkPolicy(state: LabState, serverId: string, name: string): EngineResult {
  return transact(state, (draft) => {
    const nps = requireNps(draft, serverId)
    nps.policies.splice(requirePolicy(nps, name), 1)
    return undefined
  })
}

/** Active ou désactive une stratégie réseau (une stratégie désactivée n'est pas évaluée). */
export function setNetworkPolicyEnabled(
  state: LabState,
  serverId: string,
  name: string,
  enabled: boolean
): EngineResult {
  return transact(state, (draft) => {
    const nps = requireNps(draft, serverId)
    const policy = nps.policies[requirePolicy(nps, name)]
    if (policy) policy.enabled = enabled
    return undefined
  })
}

/** Monte (-1) ou descend (+1) une stratégie dans l'ordre de traitement. */
export function moveNetworkPolicy(
  state: LabState,
  serverId: string,
  name: string,
  delta: -1 | 1
): EngineResult {
  return transact(state, (draft) => {
    const nps = requireNps(draft, serverId)
    const index = requirePolicy(nps, name)
    const target = index + delta
    if (target < 0 || target >= nps.policies.length)
      raise('CannotMove', 'La stratégie est déjà à cette extrémité de l’ordre de traitement.')
    const [policy] = nps.policies.splice(index, 1)
    if (policy) nps.policies.splice(target, 0, policy)
    return undefined
  })
}

/** Libellé de la condition d'une stratégie (groupes résolus dans le domaine du serveur). */
export function policyCondition(domain: Domain | undefined, policy: NetworkPolicy): string {
  if (policy.groups.length === 0) return 'Toute demande de connexion'
  const names = policy.groups.map((id) => {
    const group = domain?.groups.find((g) => g.id === id)
    return group ? `${domain?.netbios}\\${group.sam}` : id
  })
  return `Groupes Windows : ${names.join(' OU ')}`
}
