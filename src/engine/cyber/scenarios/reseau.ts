/**
 * Lectures communes aux scénarios « réseau » : recherche des hôtes par nom, de leur adresse, et
 * formatage Cisco. Aucune écriture, aucun calcul offensif.
 */
import { LAB_EPOCH_MS } from '../../core/clock'
import type { Device, LabState, NetInterface } from '../../model/schema'
import { effectiveIpv4 } from '../../net/addressing'

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
