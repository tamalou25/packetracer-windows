/**
 * État des interfaces vu par IOS (show ip interface brief, show interfaces, messages %LINK).
 */
import type { LabState, NetInterface } from '../model/schema'
import { linkOnInterface, otherEnd } from '../topology/queries'
import type { IosDevice } from './device'

export type IosLinkState = 'up' | 'down' | 'administratively down'

export interface IosIfaceStatus {
  /** Couche physique (Status). */
  status: IosLinkState
  /** Protocole de ligne (Protocol). */
  protocol: 'up' | 'down'
}

/** Porteuse sur le câble d'une interface physique : câble branché, l'autre extrémité active. */
function carrier(state: LabState, device: IosDevice, iface: NetInterface): boolean {
  const link = linkOnInterface(state, device.id, iface.id)
  if (!link || !device.powered) return false
  const end = otherEnd(link, device.id, iface.id)
  const peer = state.devices[end.deviceId]
  const peerIface = peer?.interfaces.find((i) => i.id === end.ifaceId)
  return !!peer && peer.powered && !!peerIface && peerIface.enabled
}

/** État IOS d'une interface (sous-interface : selon sa carte parente). */
export function ifaceStatus(state: LabState, device: IosDevice, iface: NetInterface): IosIfaceStatus {
  if (!iface.enabled) return { status: 'administratively down', protocol: 'down' }
  if (iface.subinterface) {
    const parent = device.interfaces.find((i) => i.id === iface.subinterface?.parent)
    return parent ? ifaceStatus(state, device, parent) : { status: 'down', protocol: 'down' }
  }
  return carrier(state, device, iface)
    ? { status: 'up', protocol: 'up' }
    : { status: 'down', protocol: 'down' }
}

/** Adresse MAC au format IOS (0011.2233.4455). */
export function iosMac(mac: string): string {
  const hex = mac.replace(/[^0-9a-f]/gi, '').toLowerCase()
  return `${hex.slice(0, 4)}.${hex.slice(4, 8)}.${hex.slice(8, 12)}`
}
