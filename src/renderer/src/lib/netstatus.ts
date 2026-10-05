/**
 * État des connexions réseau d'un ordinateur, tel que l'affiche le système (zone de notification,
 * Connexions réseau) : câble débranché, réseau non identifié, accès Internet… Dérivé du moteur.
 */
import {
  effectiveIpv4,
  endStatus,
  linkOnInterface,
  ping,
  type HostDevice,
  type LabState,
  type NetInterface
} from '@engine/index'

export type NetState = 'internet' | 'local' | 'no-network' | 'unplugged' | 'disabled'

export interface AdapterStatus {
  iface: NetInterface
  state: NetState
  /** Nom du réseau (domaine, « Réseau », « Réseau non identifié »). */
  network: string
  /** Libellé court (deuxième ligne dans Connexions réseau). */
  label: string
  /** Connectivité IPv4 (boîte État). */
  connectivity: string
}

/** Accès Internet par ordinateur, calculé une fois par état du lab (ping simulé, sans effet). */
const internetCache = new WeakMap<LabState, Map<string, boolean>>()

function reachesInternet(lab: LabState, deviceId: string): boolean {
  let map = internetCache.get(lab)
  if (!map) {
    map = new Map()
    internetCache.set(lab, map)
  }
  const cached = map.get(deviceId)
  if (cached !== undefined) return cached
  const r = ping(lab, deviceId, '8.8.8.8', { count: 1 })
  const ok = r.ok && r.value.success
  map.set(deviceId, ok)
  return ok
}

export function adapterStatus(lab: LabState, device: HostDevice, iface: NetInterface): AdapterStatus {
  if (!iface.enabled)
    return { iface, state: 'disabled', network: '', label: 'Désactivé', connectivity: 'Désactivé' }
  const link = linkOnInterface(lab, device.id, iface.id)
  const side = link && link.a.deviceId === device.id && link.a.ifaceId === iface.id ? 'a' : 'b'
  if (!link || endStatus(lab, link, side) === 'down' || !device.powered)
    return {
      iface,
      state: 'unplugged',
      network: '',
      label: 'Câble réseau non connecté',
      connectivity: 'Média déconnecté'
    }
  const eff = effectiveIpv4(iface)
  if (!eff || eff.source === 'apipa')
    return {
      iface,
      state: 'no-network',
      network: 'Réseau non identifié',
      label: 'Réseau non identifié',
      connectivity: 'Pas d’accès réseau'
    }
  const network = device.host.domain ?? iface.dhcpLease?.dnsSuffix ?? 'Réseau'
  if (reachesInternet(lab, device.id))
    return { iface, state: 'internet', network, label: network, connectivity: 'Internet' }
  return { iface, state: 'local', network, label: network, connectivity: 'Pas d’accès Internet' }
}

const RANK: Record<NetState, number> = { internet: 4, local: 3, 'no-network': 2, unplugged: 1, disabled: 0 }

/** Meilleur état parmi les cartes (icône de la zone de notification). */
export function hostNetwork(
  lab: LabState,
  device: HostDevice
): { state: NetState; adapters: AdapterStatus[] } {
  const adapters = device.interfaces.filter((i) => i.l3).map((i) => adapterStatus(lab, device, i))
  const best = adapters.reduce<NetState>((acc, a) => (RANK[a.state] > RANK[acc] ? a.state : acc), 'disabled')
  return { state: best, adapters }
}
