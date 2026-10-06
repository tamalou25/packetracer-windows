/**
 * Lecture de la configuration 802.1Q des ports de switch (sans dépendance : utilisée par la
 * couche 2 comme par les actions de configuration).
 */
import type { NetInterface, Switchport } from '../model/schema'

/** Port non configuré : accès, VLAN 1. */
export const DEFAULT_SWITCHPORT: Switchport = {
  mode: 'access',
  accessVlan: 1,
  nativeVlan: 1,
  allowedVlans: null
}

/** Configuration effective d'un port de switch (accès VLAN 1 si non configuré). */
export function switchportOf(iface: NetInterface): Switchport {
  return iface.switchport ?? DEFAULT_SWITCHPORT
}

/** Nom par défaut d'un VLAN créé sans nom (VLAN0010). */
export function defaultVlanName(id: number): string {
  return `VLAN${String(id).padStart(4, '0')}`
}

/** Vrai si le VLAN circule sur ce trunk. */
export function trunkAllows(port: Switchport, vlan: number): boolean {
  return port.allowedVlans === null || port.allowedVlans.includes(vlan)
}
