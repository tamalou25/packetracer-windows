/**
 * Outils de diagnostic : ping et tracert (sorties au format d'un système installé en français).
 */
import { fail, type EngineError } from '../core/result'
import type { Device, LabState } from '../model/schema'
import {
  createContext,
  ingressAddress,
  sendIp,
  sourceAddressFor,
  type Delivery,
  type SimContext
} from '../sim/forward'
import { createRecorder, type PacketTrace, type PduLayer, type TraceEffect } from '../sim/trace'
import { effectiveIpv4 } from './addressing'
import { INTERNET_REPLY_TTL, isInternetHost } from './internet'
import { isIpv4, isLoopback } from './ipv4'
import { initialTtl } from './routing'

/** Trace complétée des effets durables de l'opération (NAT, compteurs d'ACL). */
function withEffects(trace: PacketTrace, effects: TraceEffect[]): PacketTrace {
  return effects.length > 0 ? { ...trace, effects } : trace
}

export type EchoOutcome =
  | { kind: 'reply'; from: string; ttl: number; time: number }
  | { kind: 'timeout' }
  | { kind: 'unreachable'; from: string; message: string }
  | { kind: 'ttl-expired'; from: string }
  | { kind: 'transmit-failed' }

export interface PingResult {
  target: string
  lines: string[]
  trace: PacketTrace
  outcomes: EchoOutcome[]
  /** Vrai si au moins une réponse d'écho a été reçue. */
  success: boolean
}

export interface PingOptions {
  count?: number
  size?: number
  ttl?: number
}

const MSG_HOST_UNREACHABLE = 'Impossible de joindre l’hôte de destination.'
const MSG_NET_UNREACHABLE = 'Impossible de joindre le réseau de destination.'

function icmpLayer(type: number, code: number, label: string, extra: [string, string][] = []): PduLayer {
  return {
    layer: 4,
    name: 'ICMP',
    fields: [['Type', `${type} (${label})`], ['Code', String(code)], ...extra]
  }
}

/** Envoie un message d'erreur ICMP d'un routeur vers la source ; renvoie vrai s'il arrive. */
function sendIcmpError(
  ctx: SimContext,
  router: Device,
  from: string,
  to: string,
  type: number,
  code: number,
  label: string
): boolean {
  const res = sendIp(ctx, router.id, {
    src: from,
    dst: to,
    ttl: initialTtl(router),
    protocol: 'ICMP',
    ipProtocol: '1 (ICMP)',
    summary: `ICMP ${label} (${from} → ${to})`,
    upper: [icmpLayer(type, code, label)],
    // Message d'erreur ICMP lié à un échange en cours : accepté par le pare-feu à états
    reply: true
  })
  return res.kind === 'delivered'
}

/** Traduit l'échec d'acheminement d'une requête en réponse vue par l'émetteur. */
function failureOutcome(ctx: SimContext, src: Device, srcIp: string, d: Delivery): EchoOutcome {
  if (d.kind === 'delivered') return { kind: 'timeout' }
  const at = ctx.state.devices[d.deviceId]
  if (!at) return { kind: 'timeout' }
  if (d.kind === 'unresolved') {
    if (at.id === src.id) return { kind: 'unreachable', from: srcIp, message: MSG_HOST_UNREACHABLE }
    const routerIp = ingressAddress(ctx.state, d.ingress)
    if (routerIp && sendIcmpError(ctx, at, routerIp, srcIp, 3, 1, 'Destination inaccessible — hôte'))
      return { kind: 'unreachable', from: routerIp, message: MSG_HOST_UNREACHABLE }
    return { kind: 'timeout' }
  }
  if (d.kind === 'no-route') {
    if (at.id === src.id) return { kind: 'transmit-failed' }
    const routerIp = ingressAddress(ctx.state, d.ingress)
    if (routerIp && sendIcmpError(ctx, at, routerIp, srcIp, 3, 0, 'Destination inaccessible — réseau'))
      return { kind: 'unreachable', from: routerIp, message: MSG_NET_UNREACHABLE }
    return { kind: 'timeout' }
  }
  if (d.kind === 'ttl-expired') {
    const routerIp = ingressAddress(ctx.state, d.ingress)
    if (routerIp && sendIcmpError(ctx, at, routerIp, srcIp, 11, 0, 'Durée de vie expirée'))
      return { kind: 'ttl-expired', from: routerIp }
    return { kind: 'timeout' }
  }
  return { kind: 'timeout' }
}

/** Envoie une requête d'écho et attend la réponse. */
function echo(
  ctx: SimContext,
  src: Device,
  srcIp: string,
  dst: string,
  seq: number,
  ttl: number,
  size: number
): EchoOutcome {
  const request = sendIp(ctx, src.id, {
    src: srcIp,
    dst,
    ttl,
    protocol: 'ICMP',
    ipProtocol: '1 (ICMP)',
    summary: `ICMP Echo Request ${srcIp} → ${dst}`,
    upper: [
      icmpLayer(8, 0, 'Echo Request', [
        ['Séquence', String(seq)],
        ['Données', `${size} octets`]
      ])
    ]
  })
  if (request.kind !== 'delivered') return failureOutcome(ctx, src, srcIp, request)

  const responder = ctx.state.devices[request.deviceId]
  if (!responder) return { kind: 'timeout' }
  const replyTtl =
    responder.kind === 'cloud' && isInternetHost(dst) ? INTERNET_REPLY_TTL : initialTtl(responder)
  const reply = sendIp(ctx, responder.id, {
    src: dst,
    dst: request.src,
    ttl: replyTtl,
    protocol: 'ICMP',
    ipProtocol: '1 (ICMP)',
    summary: `ICMP Echo Reply ${dst} → ${request.src}`,
    reply: true,
    upper: [
      icmpLayer(0, 0, 'Echo Reply', [
        ['Séquence', String(seq)],
        ['Données', `${size} octets`]
      ])
    ]
  })
  if (reply.kind !== 'delivered') return { kind: 'timeout' }
  return { kind: 'reply', from: dst, ttl: reply.ttl, time: request.latency + reply.latency }
}

function formatTime(ms: number): string {
  return ms <= 0 ? 'temps<1ms' : `temps=${ms} ms`
}

/**
 * Ping depuis un équipement vers une adresse IPv4.
 * Renvoie la sortie console, la trace des paquets et le détail des réponses.
 */
export function ping(
  state: LabState,
  sourceId: string,
  target: string,
  options: PingOptions = {}
): { ok: true; value: PingResult } | { ok: false; error: EngineError } {
  const src = state.devices[sourceId]
  if (!src) return fail('DeviceNotFound', 'Équipement introuvable.')
  if (!src.powered) return fail('PoweredOff', `${src.name} est éteint.`)
  const dst = target.trim()
  if (!isIpv4(dst))
    return fail(
      'HostNotFound',
      `La requête Ping n’a pas pu trouver l’hôte ${dst}. Vérifiez le nom et essayez à nouveau.`
    )

  const count = Math.max(1, Math.min(options.count ?? 4, 20))
  const size = options.size ?? 32
  const ttl = options.ttl ?? initialTtl(src)
  const rec = createRecorder()
  const ctx = createContext(state, rec)
  const lines = [`Envoi d’une requête 'Ping'  ${dst} avec ${size} octets de données :`]
  const outcomes: EchoOutcome[] = []

  const local = isLoopback(dst) || src.interfaces.some((i) => effectiveIpv4(i)?.address === dst)
  const srcIp = local ? dst : sourceAddressFor(state, src, dst)

  for (let seq = 1; seq <= count; seq++) {
    let outcome: EchoOutcome
    if (local) outcome = { kind: 'reply', from: dst, ttl: initialTtl(src), time: 0 }
    else if (!srcIp) outcome = { kind: 'transmit-failed' }
    else outcome = echo(ctx, src, srcIp, dst, seq, ttl, size)
    outcomes.push(outcome)
    switch (outcome.kind) {
      case 'reply':
        lines.push(
          `Réponse de ${outcome.from} : octets=${size} ${formatTime(outcome.time)} TTL=${outcome.ttl}`
        )
        break
      case 'timeout':
        lines.push('Délai d’attente de la demande dépassé.')
        break
      case 'unreachable':
        lines.push(`Réponse de ${outcome.from} : ${outcome.message}`)
        break
      case 'ttl-expired':
        lines.push(`Réponse de ${outcome.from} : Durée de vie TTL expirée lors du transit.`)
        break
      case 'transmit-failed':
        lines.push('PING : échec de la transmission. Défaillance générale.')
        break
    }
  }

  // Comme sous Windows, une réponse « Impossible de joindre » compte comme reçue
  const received = outcomes.filter((o) => o.kind !== 'timeout' && o.kind !== 'transmit-failed').length
  const lost = count - received
  lines.push('')
  lines.push(`Statistiques Ping pour ${dst}:`)
  lines.push(
    `    Paquets : envoyés = ${count}, reçus = ${received}, perdus = ${lost} (perte ${Math.round((lost / count) * 100)}%),`
  )
  const times = outcomes
    .filter((o): o is Extract<EchoOutcome, { kind: 'reply' }> => o.kind === 'reply')
    .map((o) => o.time)
  if (times.length > 0) {
    const min = Math.min(...times)
    const max = Math.max(...times)
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length)
    lines.push('Durée approximative des boucles en millisecondes :')
    lines.push(`    Minimum = ${min}ms, Maximum = ${max}ms, Moyenne = ${avg}ms`)
  }

  return {
    ok: true,
    value: {
      target: dst,
      lines,
      outcomes,
      trace: withEffects({ title: `Ping ${src.name} → ${dst}`, events: rec.events }, ctx.effects),
      success: outcomes.some((o) => o.kind === 'reply')
    }
  }
}

export interface TracertResult {
  lines: string[]
  trace: PacketTrace
  reached: boolean
  /** Résultat de chaque saut (consoles qui formatent elles-mêmes, ex. traceroute IOS). */
  hops: EchoOutcome[]
}

/** Tracert : envoie des requêtes d'écho avec un TTL croissant. */
export function tracert(
  state: LabState,
  sourceId: string,
  target: string,
  maxHops = 30
): { ok: true; value: TracertResult } | { ok: false; error: EngineError } {
  const src = state.devices[sourceId]
  if (!src) return fail('DeviceNotFound', 'Équipement introuvable.')
  if (!src.powered) return fail('PoweredOff', `${src.name} est éteint.`)
  const dst = target.trim()
  if (!isIpv4(dst)) return fail('HostNotFound', `Impossible de résoudre le nom système cible ${dst}.`)

  const rec = createRecorder()
  const ctx = createContext(state, rec)
  const lines = [`Détermination de l’itinéraire vers ${dst} avec un maximum de ${maxHops} sauts.`, '']
  const srcIp = sourceAddressFor(state, src, dst)
  const pad = (t: string) => t.padStart(7)
  let reached = false

  if (!srcIp) {
    lines.push('Échec de la transmission. Défaillance générale.')
    return {
      ok: true,
      value: { lines, trace: { title: `Tracert ${src.name} → ${dst}`, events: [] }, reached, hops: [] }
    }
  }

  let consecutiveTimeouts = 0
  const hops: EchoOutcome[] = []
  for (let hop = 1; hop <= maxHops; hop++) {
    const outcome = echo(ctx, src, srcIp, dst, hop, hop, 32)
    hops.push(outcome)
    const n = String(hop).padStart(3)
    if (outcome.kind === 'reply' || outcome.kind === 'ttl-expired') {
      consecutiveTimeouts = 0
      const time = outcome.kind === 'reply' ? outcome.time : 0
      const t = time <= 0 ? '<1 ms' : `${time} ms`
      lines.push(`${n}  ${pad(t)}  ${pad(t)}  ${pad(t)}  ${outcome.from}`)
      if (outcome.kind === 'reply') {
        reached = true
        break
      }
    } else if (outcome.kind === 'unreachable') {
      lines.push(`${n}  ${outcome.from}  rapports : ${outcome.message}`)
      break
    } else if (outcome.kind === 'transmit-failed') {
      lines.push('Échec de la transmission. Défaillance générale.')
      break
    } else {
      consecutiveTimeouts += 1
      lines.push(`${n}  ${pad('*')}  ${pad('*')}  ${pad('*')}     Délai d’attente de la demande dépassé.`)
      // Au-delà de quelques sauts muets, la suite serait identique : on abrège
      if (consecutiveTimeouts >= 4) {
        lines.push('    …')
        break
      }
    }
  }
  lines.push('')
  lines.push('Itinéraire déterminé.')
  return {
    ok: true,
    value: {
      lines,
      trace: withEffects({ title: `Tracert ${src.name} → ${dst}`, events: rec.events }, ctx.effects),
      reached,
      hops
    }
  }
}

/** Écho ICMP reçu : réponse remise à l'hôte `deviceId` par l'adresse `from`. */
export interface EchoReceived {
  deviceId: string
  from: string
}

/**
 * Réponses d'écho (« Echo Reply ») effectivement remises à un hôte dans une trace : preuve qu'un
 * ping a réellement été exécuté et a abouti (le ping ne modifie pas l'état du lab).
 */
export function echoRepliesDelivered(trace: PacketTrace | null | undefined): EchoReceived[] {
  if (!trace) return []
  const field = (layer: PduLayer | undefined, name: string) => layer?.fields.find(([k]) => k === name)?.[1]
  return trace.events.flatMap((event) => {
    if (event.protocol !== 'ICMP' || event.outcome !== 'delivered') return []
    const icmp = event.layers.find((l) => l.name === 'ICMP')
    if (!field(icmp, 'Type')?.startsWith('0 ')) return []
    const from = field(
      event.layers.find((l) => l.name === 'IPv4'),
      'IP source'
    )
    return from ? [{ deviceId: event.toDeviceId, from }] : []
  })
}
