/**
 * Actions de configuration IP : cartes réseau, interfaces de routeur, routes statiques.
 */
import { raise, transact, type EngineResult } from '../core/result'
import { logEvent } from '../core/eventlog'
import type { LabState } from '../model/schema'
import { requireDevice } from '../topology/actions'
import { conflictingPeer } from './conflicts'
import {
  formatIpv4,
  hostAddressError,
  inNetwork,
  isIpv4,
  networkAddress,
  networkInt,
  parseIpv4,
  parseMaskOrPrefix,
  sameSubnet,
  toCidr
} from './ipv4'

export interface Ipv4ConfigInput {
  addressing: 'static' | 'dhcp'
  address?: string | null
  /** Masque (255.255.255.0) ou longueur de préfixe (24, /24). */
  mask?: string | null
  gateway?: string | null
  dnsMode?: 'static' | 'dhcp'
  dnsServers?: string[]
}

export interface ConfigOutcome {
  /** Avertissements non bloquants (comme les boîtes d'avertissement de l'assistant réseau). */
  warnings: string[]
}

const MAX_DNS_SERVERS = 4

function clean(value: string | null | undefined): string {
  return (value ?? '').trim()
}

/**
 * Configure l'adressage IPv4 d'une carte (serveur, poste, routeur, Internet).
 * Les erreurs bloquantes reprennent les messages de l'assistant de configuration.
 */
export function setInterfaceIpv4(
  state: LabState,
  deviceId: string,
  ifaceId: string,
  input: Ipv4ConfigInput
): EngineResult<ConfigOutcome> {
  return transact(state, (draft) => {
    const device = requireDevice(draft, deviceId)
    const iface = device.interfaces.find((i) => i.id === ifaceId)
    if (!iface) raise('InterfaceNotFound', 'Carte réseau introuvable.')
    if (!iface.l3) raise('NotSupported', 'Un switch de niveau 2 n’a pas d’adresse IP sur ses ports.')
    const isHost = device.kind === 'server' || device.kind === 'client'
    if (!isHost && input.addressing === 'dhcp')
      raise('NotSupported', 'Cet équipement ne peut utiliser qu’un adressage statique.')

    const warnings: string[] = []

    if (input.addressing === 'dhcp') {
      iface.addressing = 'dhcp'
      iface.address = null
      iface.prefixLength = null
      iface.gateway = null
      iface.dhcpLease = null
      iface.dhcpReleased = false
    } else {
      const address = clean(input.address)
      const mask = clean(input.mask)
      if (!address && !mask && !isHost) {
        // Effacement de l'adresse d'une interface de routeur
        iface.addressing = 'static'
        iface.address = null
        iface.prefixLength = null
        iface.gateway = null
        return { warnings }
      }
      if (!address) raise('InvalidAddress', 'Entrez une adresse IP.')
      if (!isIpv4(address)) raise('InvalidAddress', `« ${address} » n’est pas une adresse IPv4 valide.`)
      if (!mask) raise('InvalidMask', 'Entrez un masque de sous-réseau.')
      const prefix = parseMaskOrPrefix(mask)
      if (prefix === null) raise('InvalidMask', `Le masque de sous-réseau « ${mask} » n’est pas valide.`)
      const addrErr = hostAddressError(address, prefix)
      if (addrErr) raise('InvalidAddress', addrErr)

      // Un routeur ne peut pas avoir deux interfaces dans des réseaux qui se chevauchent
      if (!isHost) {
        for (const other of device.interfaces) {
          if (other.id === iface.id || !other.address || other.prefixLength === null) continue
          const p = Math.min(other.prefixLength, prefix)
          if (sameSubnet(other.address, address, p))
            raise(
              'Overlap',
              `Le réseau ${toCidr(address, prefix)} chevauche celui de l’interface ${other.name} (${toCidr(other.address, other.prefixLength)}).`
            )
        }
      }

      let gateway: string | null = null
      if (isHost) {
        const gw = clean(input.gateway)
        if (gw) {
          if (!isIpv4(gw)) raise('InvalidGateway', `« ${gw} » n’est pas une adresse de passerelle valide.`)
          if (gw === address)
            raise('InvalidGateway', 'La passerelle par défaut doit être différente de l’adresse IP.')
          if (!inNetwork(gw, networkAddress(address, prefix), prefix))
            warnings.push(
              'La passerelle par défaut n’est pas sur le même segment réseau (sous-réseau) que celui défini par l’adresse IP et le masque de sous-réseau.'
            )
          gateway = gw
        }
      }
      iface.addressing = 'static'
      iface.address = address
      iface.prefixLength = prefix
      iface.gateway = gateway
      iface.dhcpLease = null
      iface.dhcpReleased = false
    }

    if (isHost) {
      // Avec une adresse statique, les DNS sont forcément saisis manuellement
      const dnsMode = input.addressing === 'static' ? 'static' : (input.dnsMode ?? iface.dnsMode)
      iface.dnsMode = dnsMode
      if (dnsMode === 'static') {
        const servers = (input.dnsServers ?? iface.dnsServers)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
        if (servers.length > MAX_DNS_SERVERS)
          raise('InvalidDns', `${MAX_DNS_SERVERS} serveurs DNS au maximum.`)
        for (const s of servers)
          if (!isIpv4(s)) raise('InvalidDns', `« ${s} » n’est pas une adresse de serveur DNS valide.`)
        iface.dnsServers = servers
      } else {
        iface.dnsServers = []
      }
    }

    // Conflit d'adresse IP sur le segment : journalisé comme le fait la pile TCP/IP
    if (iface.addressing === 'static' && iface.address && device.powered) {
      const peer = conflictingPeer(draft as LabState, { deviceId, ifaceId }, iface.address)
      if (peer) {
        const msg = `Le système a détecté un conflit d’adresse IP pour l’adresse IP ${iface.address} avec le système dont l’adresse matérielle réseau est ${peer.mac}. Les opérations réseau de ce système peuvent être interrompues.`
        logEvent(draft, deviceId, { level: 'error', source: 'Tcpip', eventId: 4199, message: msg })
        warnings.push(
          `Conflit d’adresse IP : ${iface.address} est déjà utilisée par ${peer.name} (${peer.mac}).`
        )
      }
    }
    return { warnings }
  })
}

export interface StaticRouteInput {
  network: string
  mask: string
  nextHop: string
}

/** Ajoute une route statique à un routeur (équivalent de « ip route »). */
export function addStaticRoute(
  state: LabState,
  deviceId: string,
  input: StaticRouteInput
): EngineResult<ConfigOutcome> {
  return transact(state, (draft) => {
    const device = requireDevice(draft, deviceId)
    if (device.kind !== 'router') raise('NotSupported', 'Seuls les routeurs ont des routes statiques.')
    const network = clean(input.network)
    const nextHop = clean(input.nextHop)
    const ip = parseIpv4(network)
    if (ip === null) raise('InvalidAddress', `« ${network} » n’est pas une adresse réseau valide.`)
    const prefix = parseMaskOrPrefix(clean(input.mask))
    if (prefix === null) raise('InvalidMask', `Le masque « ${input.mask} » n’est pas valide.`)
    if (!isIpv4(nextHop))
      raise('InvalidGateway', `« ${nextHop} » n’est pas une adresse de prochain saut valide.`)
    const warnings: string[] = []
    const normalized = formatIpv4(networkInt(ip, prefix))
    if (normalized !== network)
      warnings.push(
        `Adresse réseau corrigée en ${normalized} (bits d’hôte à zéro pour le masque /${prefix}).`
      )
    if (
      device.routes.some(
        (r) => r.network === normalized && r.prefixLength === prefix && r.nextHop === nextHop
      )
    )
      raise('Duplicate', 'Cette route existe déjà.')
    const onLink = device.interfaces.some(
      (i) =>
        i.address &&
        i.prefixLength !== null &&
        inNetwork(nextHop, networkAddress(i.address, i.prefixLength), i.prefixLength)
    )
    if (!onLink)
      warnings.push(
        `Le prochain saut ${nextHop} n’est sur aucun réseau directement connecté : la route restera inactive.`
      )
    device.routes.push({ network: normalized, prefixLength: prefix, nextHop })
    return { warnings }
  })
}

export function removeStaticRoute(state: LabState, deviceId: string, index: number): EngineResult {
  return transact(state, (draft) => {
    const device = requireDevice(draft, deviceId)
    if (device.kind !== 'router') raise('NotSupported', 'Seuls les routeurs ont des routes statiques.')
    if (index < 0 || index >= device.routes.length) raise('RouteNotFound', 'Route introuvable.')
    device.routes.splice(index, 1)
    return undefined
  })
}

/** Supprime l'adresse IPv4 statique d'une carte (Remove-NetIPAddress, « Effacer l'adresse »). */
export function clearInterfaceAddress(state: LabState, deviceId: string, ifaceId: string): EngineResult {
  return transact(state, (draft) => {
    const device = requireDevice(draft, deviceId)
    const iface = device.interfaces.find((i) => i.id === ifaceId)
    if (!iface) raise('InterfaceNotFound', 'Carte réseau introuvable.')
    iface.addressing = 'static'
    iface.address = null
    iface.prefixLength = null
    iface.gateway = null
    iface.dhcpLease = null
    iface.dhcpReleased = false
    return undefined
  })
}
