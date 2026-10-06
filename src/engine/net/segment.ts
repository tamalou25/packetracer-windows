/**
 * Couche 2 : domaines de diffusion à travers les switchs.
 * Un switch est transparent (pas de VLAN ni de spanning-tree en v1). Un commutateur virtuel Hyper-V
 * est un switch hébergé ; s'il est externe, la carte physique liée de l'hôte fait office de pont.
 */
import type { LabState, Link, NetInterface, Device } from '../model/schema'

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
}

/** Chemin inverse (pour une réponse). */
export function reversePath(path: Hop[]): Hop[] {
  return [...path].reverse().map((h) => ({
    linkId: h.linkId,
    from: h.to,
    fromIfaceId: h.toIfaceId,
    to: h.from,
    toIfaceId: h.fromIfaceId
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

function peerOf(link: Link, port: PortRef): PortRef {
  return link.a.deviceId === port.deviceId && link.a.ifaceId === port.ifaceId ? link.b : link.a
}

export function resolvePort(state: LabState, port: PortRef): { device: Device; iface: NetInterface } | null {
  const device = state.devices[port.deviceId]
  const iface = device?.interfaces.find((i) => i.id === port.ifaceId)
  return device && iface ? { device, iface } : null
}

/** Vrai si le port est actif (équipement allumé, port activé). */
export function portActive(state: LabState, port: PortRef): boolean {
  const r = resolvePort(state, port)
  return !!r && r.device.powered && r.iface.enabled
}

/** Vrai si le câble branché sur ce port transmet (les deux extrémités actives). */
export function carrierUp(state: LabState, port: PortRef): boolean {
  const link = linkAt(state, port)
  return !!link && portActive(state, link.a) && portActive(state, link.b)
}

/**
 * Liste les ports de niveau 3 (serveurs, postes, routeurs, Internet) joignables en couche 2
 * depuis `origin`, avec le chemin de câbles emprunté (parcours en largeur).
 */
export function l2Segment(state: LabState, origin: PortRef): SegmentMember[] {
  if (!portActive(state, origin)) return []
  const first = linkAt(state, origin)
  if (!first) return []
  const members: SegmentMember[] = []
  const visitedSwitches = new Set<string>()
  const startPeer = peerOf(first, origin)
  const queue: SegmentMember[] = [
    {
      port: startPeer,
      path: [
        {
          linkId: first.id,
          from: origin.deviceId,
          fromIfaceId: origin.ifaceId,
          to: startPeer.deviceId,
          toIfaceId: startPeer.ifaceId
        }
      ]
    }
  ]
  while (queue.length > 0) {
    const current = queue.shift() as SegmentMember
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
      members.push(current)
      continue
    }
    if (visitedSwitches.has(sw.id)) continue
    visitedSwitches.add(sw.id)
    const enteredBy = fromUplink ? null : current.port.ifaceId
    for (const port of sw.interfaces) {
      if (port.id === enteredBy || !port.enabled) continue
      const out: PortRef = { deviceId: sw.id, ifaceId: port.id }
      const link = linkAt(state, out)
      if (!link) continue
      const next = peerOf(link, out)
      queue.push({
        port: next,
        path: [
          ...current.path,
          { linkId: link.id, from: sw.id, fromIfaceId: port.id, to: next.deviceId, toIfaceId: next.ifaceId }
        ]
      })
    }
    // Commutateur virtuel externe : sortie par la carte physique de l'hôte
    if (!fromUplink && sw.hostedBy) {
      const host = state.devices[sw.hostedBy]
      const uplink = host?.interfaces.find((i) => i.bridge === sw.id && i.enabled)
      const out = host && uplink && host.powered ? { deviceId: host.id, ifaceId: uplink.id } : null
      const link = out ? linkAt(state, out) : undefined
      if (out && link) {
        const next = peerOf(link, out)
        queue.push({
          port: next,
          path: [
            ...current.path,
            {
              linkId: link.id,
              from: out.deviceId,
              fromIfaceId: out.ifaceId,
              to: next.deviceId,
              toIfaceId: next.ifaceId
            }
          ]
        })
      }
    }
  }
  return members
}
