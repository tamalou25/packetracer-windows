/**
 * Résumé visuel d'un équipement pour le canvas : état (LED du nœud) et adresse IP principale.
 * Purement dérivé de l'état du moteur, sans le modifier.
 */
import {
  effectiveIpv4,
  endStatus,
  hasUsableAddress,
  ipConflicts,
  isHostDevice,
  linkOnInterface,
  type Device,
  type LabState
} from '@engine/index'

/** ok : opérationnel · warn : à vérifier · off : éteint · idle : aucun câble raccordé. */
export type DeviceHealth = 'ok' | 'warn' | 'off' | 'idle'

export interface HealthInfo {
  status: DeviceHealth
  /** Explication affichée dans l'infobulle de la LED. */
  label: string
}

/** Conflits d'adresses calculés une seule fois par état du lab (partagés par tous les nœuds). */
const conflictCache = new WeakMap<LabState, Set<string>>()

function conflictsOf(lab: LabState): Set<string> {
  let set = conflictCache.get(lab)
  if (!set) {
    set = ipConflicts(lab)
    conflictCache.set(lab, set)
  }
  return set
}

export function deviceHealth(lab: LabState, device: Device): HealthInfo {
  if (!device.powered) return { status: 'off', label: 'Éteint' }
  const linked = device.interfaces
    .map((iface) => ({ iface, link: linkOnInterface(lab, device.id, iface.id) }))
    .filter((x) => !!x.link)
  if (linked.length === 0) return { status: 'idle', label: 'Aucun câble raccordé' }
  if (isHostDevice(device) && device.host.pendingReboot)
    return { status: 'warn', label: 'Redémarrage requis pour appliquer des modifications' }
  const conflicts = conflictsOf(lab)
  for (const { iface, link } of linked) {
    if (!link || !iface.enabled) continue
    const side = link.a.deviceId === device.id && link.a.ifaceId === iface.id ? 'a' : 'b'
    if (endStatus(lab, link, side) === 'down')
      return { status: 'warn', label: `${iface.name} : lien inactif` }
    if (!iface.l3) continue
    if (conflicts.has(`${device.id}/${iface.id}`))
      return { status: 'warn', label: `${iface.name} : conflit d’adresse IP` }
    if (!hasUsableAddress(iface)) {
      const apipa = effectiveIpv4(iface)?.source === 'apipa'
      return {
        status: 'warn',
        label: apipa
          ? `${iface.name} : adresse APIPA (aucun serveur DHCP)`
          : `${iface.name} : pas d’adresse IPv4`
      }
    }
  }
  return { status: 'ok', label: 'Opérationnel' }
}

export interface PrimaryAddress {
  /** « 192.168.10.1/24 », ou « sans IP ». */
  text: string
  tone: 'normal' | 'warn' | 'none'
  /** Nombre d'autres interfaces adressées (routeur, serveur multi-cartes). */
  more: number
}

/**
 * Adresse IPv4 principale affichée sous le nœud (aucune pour un switch de niveau 2).
 * Une carte débranchée n'a pas d'adresse automatique (APIPA) : seule sa configuration statique compte.
 */
export function primaryAddress(lab: LabState, device: Device): PrimaryAddress | null {
  const l3 = device.interfaces.filter((i) => i.l3)
  if (l3.length === 0) return null
  const addresses = l3
    .map((i) => {
      const eff = effectiveIpv4(i)
      if (!eff) return null
      return eff.source === 'apipa' && !linkOnInterface(lab, device.id, i.id) ? null : eff
    })
    .filter((a) => a !== null)
  const first = addresses[0]
  if (!first) return device.kind === 'cloud' ? null : { text: 'sans IP', tone: 'none', more: 0 }
  return {
    text: `${first.address}/${first.prefixLength}`,
    tone: first.source === 'apipa' ? 'warn' : 'normal',
    more: addresses.length - 1
  }
}
