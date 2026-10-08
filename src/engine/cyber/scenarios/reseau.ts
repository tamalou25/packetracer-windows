/**
 * Lectures communes aux scénarios « réseau » : recherche des hôtes par nom, de leur adresse, et
 * formatage Cisco. Aucune écriture, aucun calcul offensif.
 */
import { LAB_EPOCH_MS } from '../../core/clock'
import type { Device, LabState, Link, NetInterface, SwitchDevice } from '../../model/schema'
import { effectiveIpv4 } from '../../net/addressing'
import { linkAt, peerOf } from '../../net/segment'

export const deviceByName = (state: LabState, name: string): Device | undefined =>
  Object.values(state.devices).find((d) => d.name.toLowerCase() === name.toLowerCase())

/** Première carte adressée d'un équipement. */
export function addressedPort(device: Device): { iface: NetInterface; address: string } | null {
  for (const iface of device.interfaces) {
    const eff = effectiveIpv4(iface)
    if (eff) return { iface, address: eff.address }
  }
  return null
}

/** Adresse MAC au format Cisco : 0011.2233.4455. */
export function ciscoMac(mac: string): string {
  const hex = mac.replace(/[^0-9a-f]/gi, '').toLowerCase()
  return `${hex.slice(0, 4)}.${hex.slice(4, 8)}.${hex.slice(8, 12)}`
}

/** Heure du lab au format syslog : 08:00:03 UTC. */
export function syslogTime(clock: number): string {
  return new Date(LAB_EPOCH_MS + clock).toISOString().slice(11, 19) + ' UTC'
}

/** Port de switch auquel un hôte est branché, avec sa carte et le câble. */
export interface HostPort {
  card: NetInterface
  link: Link
  sw: SwitchDevice
  port: NetInterface
}

/** Port de switch physique (ni interface VLAN, ni port routé) où l'hôte est branché, ou null. */
export function hostPortOf(state: LabState, host: Device): HostPort | null {
  const card = addressedPort(host)?.iface ?? host.interfaces[0]
  const link = card && linkAt(state, { deviceId: host.id, ifaceId: card.id })
  if (!card || !link) return null
  const peer = peerOf(link, { deviceId: host.id, ifaceId: card.id })
  const sw = state.devices[peer.deviceId]
  const port = sw?.interfaces.find((i) => i.id === peer.ifaceId)
  if (!sw || sw.kind !== 'switch' || !port || port.svi || port.l3) return null
  return { card, link, sw, port }
}
