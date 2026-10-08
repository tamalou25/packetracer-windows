/**
 * Couche 2 : domaines de diffusion à travers les switchs.
 * Les switchs physiques séparent les VLAN 802.1Q (ports d'accès, trunks étiquetés, VLAN natif) ;
 * un routeur reçoit les trames étiquetées sur ses sous-interfaces (encapsulation dot1Q).
 * Pas de spanning-tree. Un commutateur virtuel Hyper-V est un switch hébergé, sans VLAN ; s'il est
 * externe, la carte physique liée de l'hôte fait office de pont.
 */
import type { LabState, Link, NetInterface, Device } from '../model/schema'
import { switchportOf, trunkAllows } from './switchport'

export interface PortRef {
  deviceId: string
  ifaceId: string
}

/** Traversée d'un câble, de l'équipement `from` vers l'équipement `to`. */
export interface Hop {
  linkId: string
  from: string
  /** Port de sortie sur l'équipement `from`. */
  fromIfaceId: string
  to: string
  /** Port d'arrivée sur l'équipement `to`. */
  toIfaceId: string
  /** Étiquette 802.1Q de la trame sur ce câble (absente : trame non étiquetée). */
  vlan?: number
}

/** Chemin inverse (pour une réponse). */
export function reversePath(path: Hop[]): Hop[] {
  return [...path].reverse().map((h) => ({
    linkId: h.linkId,
    from: h.to,
    fromIfaceId: h.toIfaceId,
    to: h.from,
    toIfaceId: h.fromIfaceId,
    ...(h.vlan !== undefined ? { vlan: h.vlan } : {})
  }))
}

/** Équipement de niveau 3 joignable dans le domaine de diffusion, avec le chemin pour l'atteindre. */
export interface SegmentMember {
  port: PortRef
  path: Hop[]
}

const indexCache = new WeakMap<LabState['links'], Map<string, Link>>()

/** Index « équipement/port » → câble (mis en cache par version de l'état). */
export function portIndex(state: Pick<LabState, 'links'>): Map<string, Link> {
  let index = indexCache.get(state.links)
  if (!index) {
    index = new Map()
    for (const link of Object.values(state.links)) {
      index.set(`${link.a.deviceId}/${link.a.ifaceId}`, link)
      index.set(`${link.b.deviceId}/${link.b.ifaceId}`, link)
    }
    indexCache.set(state.links, index)
  }
  return index
}

export function linkAt(state: Pick<LabState, 'links'>, port: PortRef): Link | undefined {
  return portIndex(state).get(`${port.deviceId}/${port.ifaceId}`)
}

/**
 * Port physique qui porte les trames d'une carte : la carte elle-même, ou la carte parente d'une
 * sous-interface (avec le VLAN de son encapsulation).
 */
export function physicalPort(
  state: Pick<LabState, 'devices'>,
  port: PortRef
): { port: PortRef; vlan: number | null } {
  const iface = state.devices[port.deviceId]?.interfaces.find((i) => i.id === port.ifaceId)
  return iface?.subinterface
    ? { port: { deviceId: port.deviceId, ifaceId: iface.subinterface.parent }, vlan: iface.subinterface.vlan }
    : { port, vlan: null }
}

function peerOf(link: Link, port: PortRef): PortRef {
  return link.a.deviceId === port.deviceId && link.a.ifaceId === port.ifaceId ? link.b : link.a
}

export function resolvePort(state: LabState, port: PortRef): { device: Device; iface: NetInterface } | null {
  const device = state.devices[port.deviceId]
  const iface = device?.interfaces.find((i) => i.id === port.ifaceId)
  return device && iface ? { device, iface } : null
}

/** Vrai si le port est actif (équipement allumé, port activé ; carte parente d'une sous-interface). */
export function portActive(state: LabState, port: PortRef): boolean {
  const r = resolvePort(state, port)
  if (!r || !r.device.powered || !r.iface.enabled) return false
  const parent = r.iface.subinterface?.parent
  return !parent || !!r.device.interfaces.find((i) => i.id === parent)?.enabled
}

/** Vrai si le câble branché sur ce port (ou sur sa carte parente) transmet. */
export function carrierUp(state: LabState, port: PortRef): boolean {
  const link = linkAt(state, physicalPort(state, port).port)
  return !!link && portActive(state, link.a) && portActive(state, link.b)
}

/** Trame en cours d'acheminement : port atteint, chemin, étiquette sur le dernier câble. */
interface Frame extends SegmentMember {
  tag: number | null
}

/** Ajoute la traversée d'un câble au chemin (avec l'étiquette 802.1Q éventuelle). */
function extend(path: Hop[], link: Link, out: PortRef, next: PortRef, tag: number | null): Hop[] {
  return [
    ...path,
    {
      linkId: link.id,
      from: out.deviceId,
      fromIfaceId: out.ifaceId,
      to: next.deviceId,
      toIfaceId: next.ifaceId,
      ...(tag !== null ? { vlan: tag } : {})
    }
  ]
}

/**
 * VLAN d'une trame reçue sur un port de switch physique, ou null si le port la rejette
 * (trame étiquetée sur un port d'accès, VLAN non autorisé sur le trunk ou absent de la base).
 */
function ingressVlan(sw: Device, port: NetInterface, tag: number | null): number | null {
  const config = switchportOf(port)
  let vlan: number
  if (config.mode === 'access') {
    if (tag !== null) return null
    vlan = config.accessVlan
  } else {
    vlan = tag ?? config.nativeVlan
    if (!trunkAllows(config, vlan)) return null
  }
  return sw.kind === 'switch' && sw.vlans.some((v) => v.id === vlan) ? vlan : null
}

/** Étiquette de sortie d'une trame du VLAN `vlan` par ce port, ou undefined s'il ne la transmet pas. */
function egressTag(port: NetInterface, vlan: number): number | null | undefined {
  const config = switchportOf(port)
  if (config.mode === 'access') return config.accessVlan === vlan ? null : undefined
  if (!trunkAllows(config, vlan)) return undefined
  return vlan === config.nativeVlan ? null : vlan
}

/**
 * Liste les ports de niveau 3 (serveurs, postes, routeurs, Internet) joignables en couche 2
 * depuis `origin`, avec le chemin de câbles emprunté (parcours en largeur). Une sous-interface
 * émet par sa carte parente, en trames étiquetées de son VLAN.
 */
export function l2Segment(state: LabState, origin: PortRef): SegmentMember[] {
  if (!portActive(state, origin)) return []
  const members: SegmentMember[] = []
  // Switch traversé une fois par VLAN (commutateur virtuel : par étiquette transportée)
  const visited = new Set<string>()
  const queue: Frame[] = []

  /** Trame du VLAN `vlan` dans un switch physique : interfaces VLAN (SVI) puis ports de sortie. */
  const flood = (sw: Device, vlan: number, enteredBy: string | null, path: Hop[]) => {
    for (const svi of sw.interfaces)
      if (svi.svi?.vlan === vlan && svi.enabled && !(sw.id === origin.deviceId && svi.id === origin.ifaceId))
        members.push({ port: { deviceId: sw.id, ifaceId: svi.id }, path })
    for (const port of sw.interfaces) {
      if (port.id === enteredBy || !port.enabled || port.svi) continue
      const tag = egressTag(port, vlan)
      if (tag === undefined) continue
      const out: PortRef = { deviceId: sw.id, ifaceId: port.id }
      const link = linkAt(state, out)
      if (!link) continue
      const next = peerOf(link, out)
      queue.push({ port: next, path: extend(path, link, out, next, tag), tag })
    }
  }

  // Interface VLAN d'un switch : la trame part dans son VLAN, depuis le switch lui-même
  const originDevice = state.devices[origin.deviceId]
  const originSvi = originDevice?.interfaces.find((i) => i.id === origin.ifaceId)?.svi
  if (originDevice && originSvi) {
    if (originDevice.kind !== 'switch' || !originDevice.vlans.some((v) => v.id === originSvi.vlan)) return []
    visited.add(`${originDevice.id}:${originSvi.vlan}`)
    flood(originDevice, originSvi.vlan, null, [])
  } else {
    const { port: physical, vlan: originTag } = physicalPort(state, origin)
    const first = linkAt(state, physical)
    if (!first) return []
    const startPeer = peerOf(first, physical)
    queue.push({ port: startPeer, path: extend([], first, physical, startPeer, originTag), tag: originTag })
  }
  while (queue.length > 0) {
    const current = queue.shift() as Frame
    const resolved = resolvePort(state, current.port)
    if (!resolved || !resolved.device.powered || !resolved.iface.enabled) continue
    const { device, iface } = resolved
    // Switch, ou carte physique d'un hôte liée à un commutateur virtuel externe Hyper-V (pont)
    let sw: Device | undefined
    let fromUplink = false
    if (device.kind === 'switch') sw = device
    else if (iface.bridge) {
      sw = state.devices[iface.bridge]
      fromUplink = true
      if (!sw || sw.kind !== 'switch' || !sw.powered) continue
    } else {
      // Équipement de niveau 3 : trame non étiquetée sur la carte, étiquetée sur une sous-interface
      if (current.tag === null) members.push({ port: current.port, path: current.path })
      else if (device.kind === 'router') {
        const sub = device.interfaces.find(
          (i) => i.subinterface?.parent === iface.id && i.subinterface.vlan === current.tag && i.enabled
        )
        if (sub) members.push({ port: { deviceId: device.id, ifaceId: sub.id }, path: current.path })
      }
      continue
    }
    // Commutateur virtuel Hyper-V : sans VLAN, il transporte l'étiquette telle quelle
    const virtual = !!sw.hostedBy
    const vlan = virtual || fromUplink ? current.tag : ingressVlan(sw, iface, current.tag)
    if (!virtual && !fromUplink && vlan === null) continue
    const key = `${sw.id}:${vlan ?? '-'}`
    if (visited.has(key)) continue
    visited.add(key)
    const enteredBy = fromUplink ? null : current.port.ifaceId
    if (!virtual && !fromUplink) {
      flood(sw, vlan as number, enteredBy, current.path)
      continue
    }
    for (const port of sw.interfaces) {
      if (port.id === enteredBy || !port.enabled) continue
      const tag = virtual ? current.tag : egressTag(port, vlan as number)
      if (tag === undefined) continue
      const out: PortRef = { deviceId: sw.id, ifaceId: port.id }
      const link = linkAt(state, out)
      if (!link) continue
      const next = peerOf(link, out)
      queue.push({ port: next, path: extend(current.path, link, out, next, tag), tag })
    }
    // Commutateur virtuel externe : sortie par la carte physique de l'hôte
    if (!fromUplink && sw.hostedBy) {
      const host = state.devices[sw.hostedBy]
      const uplink = host?.interfaces.find((i) => i.bridge === sw.id && i.enabled)
      const out = host && uplink && host.powered ? { deviceId: host.id, ifaceId: uplink.id } : null
      const link = out ? linkAt(state, out) : undefined
      if (out && link) {
        const next = peerOf(link, out)
        queue.push({ port: next, path: extend(current.path, link, out, next, current.tag), tag: current.tag })
      }
    }
  }
  return members
}
