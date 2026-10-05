/**
 * Résumé visuel du canvas : état (LED) et adresse IP principale de chaque nœud, voyants des
 * câbles. Purement dérivé de l'état du moteur, sans le modifier ; `canvasStatus` le calcule une
 * fois pour tous les nœuds et le réutilise tant que le réseau n'a pas changé.
 */
import type { Device, LabState } from '../model/schema'
import { effectiveIpv4, hasUsableAddress } from '../net/addressing'
import { ipConflicts } from '../net/conflicts'
import { memoByNetwork } from '../net/network-key'
import { isHostDevice, linkOnInterface } from './queries'
import { endStatus, type LedStatus } from './status'

/** ok : opérationnel · warn : à vérifier · off : éteint · idle : aucun câble raccordé. */
export type DeviceHealth = 'ok' | 'warn' | 'off' | 'idle'

export interface HealthInfo {
  status: DeviceHealth
  /** Explication affichée dans l'infobulle de la LED. */
  label: string
}

export function deviceHealth(lab: LabState, device: Device): HealthInfo {
  if (!device.powered) return { status: 'off', label: 'Éteint' }
  const linked = device.interfaces
    .map((iface) => ({ iface, link: linkOnInterface(lab, device.id, iface.id) }))
    .filter((x) => !!x.link)
  if (linked.length === 0) return { status: 'idle', label: 'Aucun câble raccordé' }
  if (isHostDevice(device) && device.host.pendingReboot)
    return { status: 'warn', label: 'Redémarrage requis pour appliquer des modifications' }
  const conflicts = ipConflicts(lab)
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

/** Résumé d'un nœud du canvas. */
export interface DeviceView {
  health: HealthInfo
  ip: PrimaryAddress | null
}

/** Résumé d'un câble du canvas : voyants et noms des ports aux deux extrémités. */
export interface LinkView {
  a: LedStatus
  b: LedStatus
  portA: string
  portB: string
}

export interface CanvasStatus {
  devices: Record<string, DeviceView>
  links: Record<string, LinkView>
}

const sameHealth = (x: HealthInfo, y: HealthInfo) => x.status === y.status && x.label === y.label
const sameIp = (x: PrimaryAddress | null, y: PrimaryAddress | null) =>
  x === y || (!!x && !!y && x.text === y.text && x.tone === y.tone && x.more === y.more)
const sameLink = (x: LinkView, y: LinkView) =>
  x.a === y.a && x.b === y.b && x.portA === y.portA && x.portB === y.portB

let previous: CanvasStatus = { devices: {}, links: {} }

/**
 * Calcule le résumé de tous les nœuds et câbles. Une entrée identique à celle du calcul précédent
 * est réutilisée par référence : seuls les nœuds réellement modifiés sont redessinés.
 */
function computeCanvasStatus(lab: LabState): CanvasStatus {
  const devices: Record<string, DeviceView> = {}
  for (const device of Object.values(lab.devices)) {
    const view = { health: deviceHealth(lab, device), ip: primaryAddress(lab, device) }
    const old = previous.devices[device.id]
    devices[device.id] = old && sameHealth(old.health, view.health) && sameIp(old.ip, view.ip) ? old : view
  }
  const links: Record<string, LinkView> = {}
  for (const link of Object.values(lab.links)) {
    const portName = (end: typeof link.a) =>
      lab.devices[end.deviceId]?.interfaces.find((i) => i.id === end.ifaceId)?.name ?? ''
    const view = {
      a: endStatus(lab, link, 'a'),
      b: endStatus(lab, link, 'b'),
      portA: portName(link.a),
      portB: portName(link.b)
    }
    const old = previous.links[link.id]
    links[link.id] = old && sameLink(old, view) ? old : view
  }
  previous = { devices, links }
  return previous
}

/** Résumé du canvas, recalculé seulement quand le réseau ou un redémarrage en attente change. */
export const canvasStatus: (lab: LabState) => CanvasStatus = memoByNetwork(
  computeCanvasStatus,
  (before, after) =>
    !isHostDevice(before) || !isHostDevice(after) || before.host.pendingReboot === after.host.pendingReboot
)
