/**
 * Moteur d'acheminement : résolution ARP et transfert IP saut par saut.
 * Chaque trame produite est enregistrée dans la trace (mode Simulation).
 */
import type { Device, LabState } from '../model/schema'
import { effectiveIpv4 } from '../net/addressing'
import { isInternetHost } from '../net/internet'
import { lookupRoute, routingTable } from '../net/routing'
import { l2Segment, reversePath, type PortRef, type SegmentMember } from '../net/segment'
import {
  BROADCAST_MAC,
  ethernetLayer,
  ipv4Layer,
  type PduEvent,
  type PduLayer,
  type PduOutcome,
  type Protocol,
  type TraceRecorder
} from './trace'

/** Contexte de calcul : état (lecture seule), trace et cache ARP de l'opération. */
export interface SimContext {
  state: LabState
  rec: TraceRecorder
  /** Cache ARP par équipement : IP → port qui la porte. */
  arp: Map<string, Map<string, SegmentMember>>
}

export function createContext(state: LabState, rec: TraceRecorder): SimContext {
  return { state, rec, arp: new Map() }
}

function deviceName(ctx: SimContext, id: string): string {
  return ctx.state.devices[id]?.name ?? id
}

function ifaceOf(ctx: SimContext, port: PortRef) {
  return ctx.state.devices[port.deviceId]?.interfaces.find((i) => i.id === port.ifaceId)
}

/** Vrai si l'équipement possède l'adresse IP (cartes actives, hôtes Internet pour le nuage). */
export function ownsAddress(device: Device, ip: string): boolean {
  if (!device.powered) return false
  if (device.kind === 'cloud' && isInternetHost(ip)) return true
  return device.interfaces.some((i) => effectiveIpv4(i)?.address === ip)
}

/** Port de l'équipement portant cette adresse IP. */
export function portWithAddress(device: Device, ip: string): PortRef | null {
  const iface = device.interfaces.find((i) => effectiveIpv4(i)?.address === ip)
  return iface ? { deviceId: device.id, ifaceId: iface.id } : null
}

interface FrameSpec {
  protocol: Protocol
  summary: string
  layers: PduLayer[]
}

/**
 * Enregistre une trame unicast le long d'un chemin (à travers les switchs).
 * Renvoie l'index du dernier événement (arrivée sur la destination).
 */
export function recordUnicast(
  ctx: SimContext,
  path: SegmentMember['path'],
  frame: FrameSpec,
  finalOutcome: PduOutcome,
  finalNote: string
): number {
  path.forEach((hop, i) => {
    const last = i === path.length - 1
    const to = ctx.state.devices[hop.to]
    const port = to?.interfaces.find((p) => p.id === hop.toIfaceId)?.name ?? ''
    const outId = path[i + 1]?.fromIfaceId
    const outPort = to?.interfaces.find((p) => p.id === outId)?.name ?? ''
    ctx.rec.step += 1
    ctx.rec.events.push({
      step: ctx.rec.step,
      protocol: frame.protocol,
      linkId: hop.linkId,
      fromDeviceId: hop.from,
      toDeviceId: hop.to,
      summary: frame.summary,
      layers: frame.layers,
      outcome: last ? finalOutcome : 'forwarded',
      note: last
        ? finalNote
        : `${to?.name ?? '?'} reçoit la trame sur ${port} et la commute vers ${outPort} (adresse MAC de destination connue).`
    })
  })
  return ctx.rec.events.length - 1
}

/** Modifie le devenir du dernier événement enregistré (décision prise à l'arrivée). */
function setLastOutcome(ctx: SimContext, outcome: PduOutcome, note: string): void {
  const last = ctx.rec.events[ctx.rec.events.length - 1]
  if (last) {
    last.outcome = outcome
    last.note = note
  }
}

/**
 * Diffusion (broadcast) dans le domaine de niveau 2 : la trame est inondée par les switchs.
 * `accept` indique si un membre traite la trame (sinon il l'ignore).
 */
export function recordBroadcast(
  ctx: SimContext,
  origin: PortRef,
  frame: FrameSpec,
  accept: (member: SegmentMember) => { outcome: PduOutcome; note: string }
): SegmentMember[] {
  const members = l2Segment(ctx.state, origin)
  const base = ctx.rec.step
  const seen = new Set<string>()
  let maxDepth = 0
  for (const member of members) {
    member.path.forEach((hop, depth) => {
      const key = `${hop.linkId}>${hop.to}`
      const last = depth === member.path.length - 1
      maxDepth = Math.max(maxDepth, depth + 1)
      if (seen.has(key)) return
      seen.add(key)
      const to = ctx.state.devices[hop.to]
      const decision = last ? accept(member) : null
      const event: PduEvent = {
        step: base + depth + 1,
        protocol: frame.protocol,
        linkId: hop.linkId,
        fromDeviceId: hop.from,
        toDeviceId: hop.to,
        summary: frame.summary,
        layers: frame.layers,
        outcome: decision ? decision.outcome : 'forwarded',
        note: decision
          ? decision.note
          : `${to?.name ?? '?'} diffuse la trame (broadcast) sur tous ses autres ports.`
      }
      ctx.rec.events.push(event)
    })
  }
  ctx.rec.events.sort((a, b) => a.step - b.step)
  ctx.rec.step = base + maxDepth
  return members
}

/**
 * Résolution ARP de `targetIp` depuis un port. Renvoie le membre du segment qui répond,
 * ou null si personne ne répond.
 */
export function arpResolve(ctx: SimContext, origin: PortRef, targetIp: string): SegmentMember | null {
  let cache = ctx.arp.get(origin.deviceId)
  if (!cache) {
    cache = new Map()
    ctx.arp.set(origin.deviceId, cache)
  }
  const cached = cache.get(targetIp)
  if (cached) return cached

  const srcIface = ifaceOf(ctx, origin)
  const srcIp = srcIface ? (effectiveIpv4(srcIface)?.address ?? '0.0.0.0') : '0.0.0.0'
  const srcMac = srcIface?.mac ?? ''
  const requester = deviceName(ctx, origin.deviceId)
  let responder: SegmentMember | null = null

  const owns = (member: SegmentMember): boolean => {
    const iface = ifaceOf(ctx, member.port)
    return !!iface && effectiveIpv4(iface)?.address === targetIp
  }

  recordBroadcast(
    ctx,
    origin,
    {
      protocol: 'ARP',
      summary: `ARP : qui a ${targetIp} ? Répondre à ${srcIp}`,
      layers: [
        ethernetLayer(srcMac, BROADCAST_MAC, 'ARP'),
        {
          layer: 3,
          name: 'ARP',
          fields: [
            ['Opération', '1 (requête)'],
            ['MAC émetteur', srcMac],
            ['IP émetteur', srcIp],
            ['MAC cible', '00-00-00-00-00-00'],
            ['IP cible', targetIp]
          ]
        }
      ]
    },
    (member) => {
      const name = deviceName(ctx, member.port.deviceId)
      if (!responder && owns(member)) {
        responder = member
        return {
          outcome: 'delivered',
          note: `${name} reconnaît son adresse IP ${targetIp} et prépare une réponse ARP.`
        }
      }
      return {
        outcome: 'ignored',
        note: `${name} ignore la requête ARP : ${targetIp} n’est pas son adresse.`
      }
    }
  )

  const found = responder as SegmentMember | null
  if (!found) return null
  const targetIface = ifaceOf(ctx, found.port)
  const targetMac = targetIface?.mac ?? ''
  const back = reversePath(found.path)
  recordUnicast(
    ctx,
    back,
    {
      protocol: 'ARP',
      summary: `ARP : ${targetIp} est à ${targetMac}`,
      layers: [
        ethernetLayer(targetMac, srcMac, 'ARP'),
        {
          layer: 3,
          name: 'ARP',
          fields: [
            ['Opération', '2 (réponse)'],
            ['MAC émetteur', targetMac],
            ['IP émetteur', targetIp],
            ['MAC cible', srcMac],
            ['IP cible', srcIp]
          ]
        }
      ]
    },
    'delivered',
    `${requester} enregistre ${targetIp} → ${targetMac} dans son cache ARP.`
  )
  cache.set(targetIp, found)
  // La cible a appris l'adresse du demandeur grâce à la requête : pas de nouvel ARP pour répondre
  if (srcIp !== '0.0.0.0') {
    let targetCache = ctx.arp.get(found.port.deviceId)
    if (!targetCache) {
      targetCache = new Map()
      ctx.arp.set(found.port.deviceId, targetCache)
    }
    if (!targetCache.has(srcIp)) targetCache.set(srcIp, { port: origin, path: back })
  }
  return found
}

export interface IpPacket {
  src: string
  dst: string
  ttl: number
  protocol: Protocol
  /** Nom du protocole IP (champ « Protocole » de l'en-tête). */
  ipProtocol: string
  summary: string
  /** Couches 4 à 7. */
  upper: PduLayer[]
}

export type Delivery =
  | { kind: 'delivered'; deviceId: string; ingress: PortRef | null; ttl: number; latency: number }
  | { kind: 'no-route'; deviceId: string; ingress: PortRef | null; latency: number }
  | { kind: 'unresolved'; deviceId: string; ingress: PortRef | null; nextHop: string; latency: number }
  | { kind: 'ttl-expired'; deviceId: string; ingress: PortRef | null; latency: number }
  | { kind: 'dropped'; deviceId: string; latency: number }

/** Latence ajoutée par la traversée d'un équipement (ms, aller simple). */
function hopLatency(device: Device): number {
  if (device.kind === 'cloud') return 7
  if (device.kind === 'router') return 1
  return 0
}

/**
 * Achemine un paquet IP depuis `fromDeviceId` jusqu'à sa destination (ou son échec).
 * Les décisions de chaque équipement sont expliquées dans la trace.
 */
export function sendIp(ctx: SimContext, fromDeviceId: string, packet: IpPacket): Delivery {
  let current = fromDeviceId
  let ingress: PortRef | null = null
  let ttl = packet.ttl
  let latency = 0

  for (let guard = 0; guard < 64; guard++) {
    const device = ctx.state.devices[current]
    if (!device || !device.powered) return { kind: 'dropped', deviceId: current, latency }

    if (ownsAddress(device, packet.dst)) {
      if (current !== fromDeviceId)
        setLastOutcome(
          ctx,
          'delivered',
          `${device.name} est le destinataire (${packet.dst}) : le paquet est traité.`
        )
      return { kind: 'delivered', deviceId: current, ingress, ttl, latency }
    }

    if (current !== fromDeviceId) {
      if (device.kind === 'server' || device.kind === 'client') {
        setLastOutcome(
          ctx,
          'dropped',
          `${device.name} n’est pas un routeur : le paquet destiné à ${packet.dst} est ignoré.`
        )
        return { kind: 'dropped', deviceId: current, latency }
      }
      if (device.kind === 'cloud') {
        setLastOutcome(ctx, 'dropped', `Aucun hôte Internet ne répond à l’adresse ${packet.dst}.`)
        return { kind: 'dropped', deviceId: current, latency }
      }
      ttl -= 1
      latency += hopLatency(device)
      if (ttl <= 0) {
        setLastOutcome(
          ctx,
          'dropped',
          `${device.name} décrémente le TTL qui atteint 0 : le paquet est détruit.`
        )
        return { kind: 'ttl-expired', deviceId: current, ingress, latency }
      }
    }

    const route = lookupRoute(routingTable(ctx.state, device), packet.dst)
    if (!route) {
      if (current !== fromDeviceId)
        setLastOutcome(
          ctx,
          'dropped',
          `${device.name} n’a aucune route vers ${packet.dst} : le paquet est rejeté.`
        )
      return { kind: 'no-route', deviceId: current, ingress, latency }
    }
    const egress: PortRef = { deviceId: current, ifaceId: route.ifaceId }
    const nextHop = route.gateway ?? packet.dst
    if (current !== fromDeviceId) {
      const egressName = ifaceOf(ctx, egress)?.name ?? ''
      setLastOutcome(
        ctx,
        'forwarded',
        route.gateway
          ? `${device.name} route le paquet vers ${packet.dst} par ${egressName}, via la passerelle ${route.gateway} (TTL ${ttl}).`
          : `${device.name} route le paquet vers ${packet.dst} : réseau directement connecté sur ${egressName} (TTL ${ttl}).`
      )
    }

    const target = arpResolve(ctx, egress, nextHop)
    if (!target) return { kind: 'unresolved', deviceId: current, ingress, nextHop, latency }

    const srcMac = ifaceOf(ctx, egress)?.mac ?? ''
    const dstMac = ifaceOf(ctx, target.port)?.mac ?? ''
    const targetDevice = ctx.state.devices[target.port.deviceId]
    recordUnicast(
      ctx,
      target.path,
      {
        protocol: packet.protocol,
        summary: packet.summary,
        layers: [
          ethernetLayer(srcMac, dstMac, 'IPv4'),
          ipv4Layer(packet.src, packet.dst, ttl, packet.ipProtocol),
          ...packet.upper
        ]
      },
      'forwarded',
      `${targetDevice?.name ?? '?'} reçoit le paquet.`
    )
    current = target.port.deviceId
    ingress = target.port
  }
  return { kind: 'dropped', deviceId: current, latency }
}

/** Adresse source utilisée par un équipement pour joindre `dst` (carte de sortie). */
export function sourceAddressFor(state: LabState, device: Device, dst: string): string | null {
  const route = lookupRoute(routingTable(state, device), dst)
  if (!route) return null
  const iface = device.interfaces.find((i) => i.id === route.ifaceId)
  return iface ? (effectiveIpv4(iface)?.address ?? null) : null
}

/** Adresse IP du port d'entrée d'un équipement (adresse affichée par tracert). */
export function ingressAddress(state: LabState, port: PortRef | null): string | null {
  if (!port) return null
  const iface = state.devices[port.deviceId]?.interfaces.find((i) => i.id === port.ifaceId)
  return iface ? (effectiveIpv4(iface)?.address ?? null) : null
}
