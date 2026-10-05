/**
 * État des liens (voyants aux extrémités des câbles).
 *  - vert (up)        : porteuse établie et adressage correct
 *  - orange (degraded): porteuse établie mais carte sans adresse exploitable (aucune, APIPA ou en conflit)
 *  - rouge (down)     : équipement éteint ou port désactivé (d'un côté ou de l'autre)
 */
import type { LabState, Link, LinkEnd } from '../model/schema'
import { hasUsableAddress } from '../net/addressing'
import { ipConflicts } from '../net/conflicts'

export type LedStatus = 'up' | 'degraded' | 'down'

function endCarrier(state: LabState, end: LinkEnd): boolean {
  const device = state.devices[end.deviceId]
  const iface = device?.interfaces.find((i) => i.id === end.ifaceId)
  return !!device && !!iface && device.powered && iface.enabled
}

/** Couleur du voyant à une extrémité donnée du câble. */
export function endStatus(state: LabState, link: Link, side: 'a' | 'b'): LedStatus {
  const end = link[side]
  const other = side === 'a' ? link.b : link.a
  if (!endCarrier(state, end) || !endCarrier(state, other)) return 'down'
  const iface = state.devices[end.deviceId]?.interfaces.find((i) => i.id === end.ifaceId)
  if (iface && iface.l3 && !hasUsableAddress(iface)) return 'degraded'
  if (iface && iface.l3 && ipConflicts(state).has(`${end.deviceId}/${end.ifaceId}`)) return 'degraded'
  return 'up'
}

/** État global d'un câble (le pire des deux extrémités). */
export function linkStatus(state: LabState, link: Link): LedStatus {
  const a = endStatus(state, link, 'a')
  const b = endStatus(state, link, 'b')
  if (a === 'down' || b === 'down') return 'down'
  if (a === 'degraded' || b === 'degraded') return 'degraded'
  return 'up'
}
