/**
 * Routage et accès distant : assistant de configuration (NAT, VPN, VPN et NAT, routage LAN),
 * désactivation, pool d'adresses des clients VPN.
 */
import type { Draft } from 'immer'
import { raise, transact, type EngineResult } from '../../core/result'
import type { LabState, ServerDevice } from '../../model/schema'
import { effectiveIpv4 } from '../../net/addressing'
import { formatIpv4, isIpv4, parseIpv4 } from '../../net/ipv4'
import { requireDevice } from '../../topology/actions'
import { ensureRoleState } from '../state'
import { RRAS_MODES, type RrasMode } from './schema'
import { RRAS_STATE } from './state'

export const MODE_LABELS: Record<RrasMode, string> = {
  nat: 'Traduction d’adresses réseau (NAT)',
  vpn: 'Accès à distance (VPN)',
  'vpn-nat': 'Accès VPN et NAT',
  routing: 'Routage LAN'
}

/** Taille maximale d'un pool d'adresses VPN simulé. */
const MAX_POOL = 254

function requireRras(draft: Draft<LabState>, deviceId: string): Draft<ServerDevice> {
  const server = requireDevice(draft, deviceId)
  if (server.kind !== 'server' || !server.host.features.includes('RemoteAccess'))
    raise('RrasNotInstalled', 'Le rôle Accès à distance n’est pas installé sur cet ordinateur.')
  return server
}

export interface PoolInput {
  start: string
  end: string
}

/** Contrôle d'un pool d'adresses : adresses valides, début ≤ fin, taille raisonnable. */
export function validatePool(pool: PoolInput): PoolInput {
  const start = pool.start.trim()
  const end = pool.end.trim()
  if (!isIpv4(start) || !isIpv4(end))
    raise('InvalidPool', 'Indiquez une adresse IPv4 de début et de fin valides pour le pool.')
  const a = parseIpv4(start) ?? 0
  const b = parseIpv4(end) ?? 0
  if (a > b) raise('InvalidPool', 'L’adresse de fin doit être supérieure ou égale à l’adresse de début.')
  if (b - a + 1 > MAX_POOL) raise('InvalidPool', `Le pool simulé contient au plus ${MAX_POOL} adresses.`)
  return { start, end }
}

export interface ConfigureInput {
  mode: RrasMode
  /** Interface connectée à Internet (NAT, VPN). */
  publicIfaceId?: string | null
  /** Pool d'adresses des clients VPN. */
  pool?: PoolInput | null
}

/** Assistant « Configurer et activer le routage et l'accès distant ». */
export function configureRras(state: LabState, deviceId: string, input: ConfigureInput): EngineResult {
  return transact(state, (draft) => {
    const server = requireRras(draft, deviceId)
    const rras = ensureRoleState(server, RRAS_STATE)
    if (!RRAS_MODES.includes(input.mode)) raise('InvalidMode', 'Configuration inconnue.')
    if (rras.mode)
      raise(
        'AlreadyConfigured',
        'Le routage et l’accès distant est déjà configuré sur ce serveur : désactivez-le avant de relancer l’assistant.'
      )
    const needsRouting = input.mode !== 'vpn'
    const needsVpn = input.mode === 'vpn' || input.mode === 'vpn-nat'
    if (needsRouting && !server.host.features.includes('Routing'))
      raise('FeatureMissing', 'Le service de rôle Routage doit être installé.')
    if (needsVpn && !server.host.features.includes('DirectAccess-VPN'))
      raise('FeatureMissing', 'Le service de rôle DirectAccess et VPN (accès à distance) doit être installé.')
    let publicIfaceId: string | null = null
    if (input.mode !== 'routing') {
      const addressed = server.interfaces.filter((i) => i.l3 && effectiveIpv4(i))
      if (addressed.length < 2)
        raise(
          'TwoInterfacesRequired',
          'Cet ordinateur doit disposer d’au moins deux interfaces réseau configurées : l’une connectée à Internet, l’autre au réseau privé.'
        )
      const iface = addressed.find((i) => i.id === input.publicIfaceId)
      if (!iface)
        raise('InvalidInterface', 'Sélectionnez l’interface réseau qui connecte ce serveur à Internet.')
      publicIfaceId = iface.id
    }
    rras.mode = input.mode
    rras.publicIfaceId = publicIfaceId
    rras.pool = needsVpn ? validatePool(input.pool ?? { start: '', end: '' }) : null
    rras.sessions = []
    return undefined
  })
}

/** Désactive le routage et l'accès distant : les clients VPN sont déconnectés. */
export function disableRras(state: LabState, deviceId: string): EngineResult {
  return transact(state, (draft) => {
    const server = requireRras(draft, deviceId)
    const rras = ensureRoleState(server, RRAS_STATE)
    if (!rras.mode) raise('NotConfigured', 'Le routage et l’accès distant n’est pas configuré.')
    for (const d of Object.values(draft.devices))
      if (d.kind === 'server' || d.kind === 'client')
        for (const c of d.host.vpnConnections)
          if (c.connected?.serverDeviceId === server.id) c.connected = null
    rras.mode = null
    rras.publicIfaceId = null
    rras.pool = null
    rras.sessions = []
    return undefined
  })
}

/** Pool d'adresses statiques des clients VPN (Set-VpnIPAddressAssignment). */
export function setVpnPool(state: LabState, deviceId: string, pool: PoolInput): EngineResult {
  return transact(state, (draft) => {
    const rras = ensureRoleState(requireRras(draft, deviceId), RRAS_STATE)
    if (rras.mode !== 'vpn' && rras.mode !== 'vpn-nat')
      raise('VpnNotConfigured', 'L’accès à distance VPN n’est pas configuré sur ce serveur.')
    rras.pool = validatePool(pool)
    return undefined
  })
}

/** Première adresse libre du pool (null : pool épuisé). */
export function freePoolAddress(rras: {
  pool: PoolInput | null
  sessions: { address: string }[]
}): string | null {
  if (!rras.pool) return null
  const a = parseIpv4(rras.pool.start) ?? 0
  const b = parseIpv4(rras.pool.end) ?? -1
  for (let v = a; v <= b; v++) {
    const ip = formatIpv4(v)
    if (!rras.sessions.some((s) => s.address === ip)) return ip
  }
  return null
}

/**
 * Ajoute un serveur RADIUS d'authentification (Add-RemoteAccessRadius) : les clients VPN sont
 * désormais authentifiés par RADIUS.
 */
export function addRadiusServer(
  state: LabState,
  deviceId: string,
  input: { server: string; sharedSecret: string }
): EngineResult {
  return transact(state, (draft) => {
    const rras = ensureRoleState(requireRras(draft, deviceId), RRAS_STATE)
    const server = input.server.trim()
    if (!server) raise('InvalidServer', 'Indiquez le nom ou l’adresse du serveur RADIUS.')
    if (!input.sharedSecret) raise('InvalidSecret', 'Indiquez le secret partagé du serveur RADIUS.')
    if (rras.radius.some((r) => r.server.toLowerCase() === server.toLowerCase()))
      raise('RadiusServerExists', `Le serveur RADIUS ${server} est déjà configuré.`)
    rras.radius.push({ server, sharedSecret: input.sharedSecret })
    return undefined
  })
}

/** Retire un serveur RADIUS (sans serveur RADIUS : authentification Windows). */
export function removeRadiusServer(state: LabState, deviceId: string, server: string): EngineResult {
  return transact(state, (draft) => {
    const rras = ensureRoleState(requireRras(draft, deviceId), RRAS_STATE)
    const index = rras.radius.findIndex((r) => r.server.toLowerCase() === server.trim().toLowerCase())
    if (index < 0) raise('RadiusServerNotFound', `Le serveur RADIUS ${server} n’est pas configuré.`)
    rras.radius.splice(index, 1)
    return undefined
  })
}
