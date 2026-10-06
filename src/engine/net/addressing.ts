/**
 * Adressage effectif d'une carte réseau (statique, DHCP ou APIPA).
 */
import type { NetInterface } from '../model/schema'
import { apipaFromMac, isApipa } from './ipv4'

export type AddressSource = 'static' | 'dhcp' | 'apipa'

export interface EffectiveIpv4 {
  address: string
  prefixLength: number
  gateway: string | null
  dnsServers: string[]
  source: AddressSource
}

/** Configuration IPv4 réellement utilisée par la carte, ou null si elle n'en a pas. */
export function effectiveIpv4(iface: NetInterface): EffectiveIpv4 | null {
  if (!iface.l3 || !iface.enabled || iface.bridge) return null
  if (iface.addressing === 'static') {
    if (!iface.address || iface.prefixLength === null) return null
    return {
      address: iface.address,
      prefixLength: iface.prefixLength,
      gateway: iface.gateway,
      dnsServers: [...iface.dnsServers],
      source: 'static'
    }
  }
  if (iface.dhcpReleased) return null
  const lease = iface.dhcpLease
  if (lease) {
    return {
      address: lease.address,
      prefixLength: lease.prefixLength,
      gateway: lease.gateway,
      dnsServers: iface.dnsMode === 'dhcp' ? [...lease.dnsServers] : [...iface.dnsServers],
      source: 'dhcp'
    }
  }
  // Aucun serveur DHCP n'a répondu : adresse privée automatique (APIPA)
  return {
    address: apipaFromMac(iface.mac),
    prefixLength: 16,
    gateway: null,
    dnsServers: iface.dnsMode === 'static' ? [...iface.dnsServers] : [],
    source: 'apipa'
  }
}

/** Vrai si la carte dispose d'une adresse exploitable (ni absente, ni APIPA). */
export function hasUsableAddress(iface: NetInterface): boolean {
  const eff = effectiveIpv4(iface)
  return eff !== null && !isApipa(eff.address)
}
