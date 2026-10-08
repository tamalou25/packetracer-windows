/**
 * État des interfaces vu par IOS (show ip interface brief, show interfaces, messages %LINK).
 */
import type { LabState, NetInterface } from '../model/schema'
import { switchportOf, trunkAllows } from '../net/switchport'
import { linkOnInterface, otherEnd } from '../topology/queries'
import type { IosDevice } from './device'

export type IosLinkState = 'up' | 'down' | 'administratively down'

export interface IosIfaceStatus {
  /** Couche physique (Status). */
  status: IosLinkState
  /** Protocole de ligne (Protocol). */
  protocol: 'up' | 'down'
  /** Port en err-disabled (violation de port-security). */
  errDisabled?: boolean
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
  // Port désactivé sur violation de port-security : down/down (err-disabled)
  if (device.ios?.interfaces[iface.name]?.errDisabled)
    return { status: 'down', protocol: 'down', errDisabled: true }
  if (!iface.enabled) return { status: 'administratively down', protocol: 'down' }
  if (iface.svi) {
    // Interface VLAN : up si le VLAN existe et qu'un port actif le transporte
    const vlan = iface.svi.vlan
    const exists = device.kind === 'switch' && device.vlans.some((v) => v.id === vlan)
    const carried = device.interfaces.some((p) => {
      if (p.svi || !p.enabled || !carrier(state, device, p)) return false
      const sp = switchportOf(p)
      return sp.mode === 'access' ? sp.accessVlan === vlan : trunkAllows(sp, vlan)
    })
    return exists && carried ? { status: 'up', protocol: 'up' } : { status: 'down', protocol: 'down' }
  }
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
