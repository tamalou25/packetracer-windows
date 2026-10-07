/**
 * Authentification RADIUS : le serveur d'accès (client RADIUS, ex. serveur VPN) transmet la
 * demande au serveur NPS (UDP 1812), qui vérifie le client et son secret partagé, authentifie
 * l'utilisateur dans le domaine puis applique la première stratégie réseau correspondante.
 * Codes de raison NPS : 16 (identifiants), 34 (compte désactivé), 48 (aucune stratégie),
 * 65 (autorisation d'accès refusée).
 */
import type { NewEvent } from '../../core/eventlog'
import type { Device, LabState, ServerDevice } from '../../model/schema'
import { isIpv4 } from '../../net/ipv4'
import { initialTtl } from '../../net/routing'
import { createContext, sendIp, sourceAddressFor, type SimContext } from '../../sim/forward'
import { concatTraces, createRecorder, type PacketTrace, type PduLayer } from '../../sim/trace'
import { authenticate, splitAccount } from '../adds/credentials'
import { firstAddress, resolveName } from '../dns/resolver'
import { domainOf, domainToken, type AccessToken } from '../files/acl'
import { npsOf } from './state'

/** Port UDP d'authentification RADIUS. */
export const RADIUS_PORT = 1812

export type NpsReason = 0 | 16 | 34 | 48 | 65

/** Raisons affichées dans les événements 6273. */
export const NPS_REASONS: Record<Exclude<NpsReason, 0>, string> = {
  16: 'Échec de l’authentification en raison d’une incompatibilité des informations d’identification de l’utilisateur : le nom d’utilisateur ne correspond à aucun compte ou le mot de passe est incorrect.',
  34: 'Le compte d’utilisateur indiqué dans la demande RADIUS est désactivé.',
  48: 'La demande de connexion ne correspond à aucune stratégie réseau configurée.',
  65: 'L’autorisation d’accès réseau du compte d’utilisateur a été refusée : la stratégie réseau correspondante refuse l’accès.'
}

export interface NpsDecision {
  granted: boolean
  reason: NpsReason
  /** Stratégie réseau appliquée (null : aucune ne correspond). */
  policy: string | null
}

/** Stratégies réseau dans l'ordre de traitement : la première dont la condition est remplie s'applique. */
export function evaluatePolicies(nps: ServerDevice, token: AccessToken): NpsDecision {
  for (const policy of npsOf(nps)?.policies ?? []) {
    if (!policy.enabled) continue
    if (policy.groups.length > 0 && !policy.groups.some((g) => token.sids.includes(g))) continue
    return policy.access === 'Grant'
      ? { granted: true, reason: 0, policy: policy.name }
      : { granted: false, reason: 65, policy: policy.name }
  }
  return { granted: false, reason: 48, policy: null }
}

/** Décision du serveur NPS pour un compte du domaine (identifiants supposés valides), ou null. */
export function npsAccessFor(state: LabState, nps: ServerDevice, user: string): NpsDecision | null {
  const domain = domainOf(state, nps)
  if (!domain) return null
  const token = domainToken(domain, splitAccount(user).sam)
  return token ? evaluatePolicies(nps, token) : null
}

/** Authentifie le compte sur le serveur NPS puis applique les stratégies réseau. */
function decide(
  state: LabState,
  nps: ServerDevice,
  user: string,
  password: string
): NpsDecision & { account: string } {
  const token = authenticate(state, nps, user, password)
  if (token) return { ...evaluatePolicies(nps, token), account: token.account }
  // Bon mot de passe d'un compte désactivé : raison distincte
  const domain = domainOf(state, nps)
  const { sam } = splitAccount(user)
  const account = domain?.users.find((u) => u.sam.toLowerCase() === sam.toLowerCase())
  if (domain && account && !account.enabled && account.password === password)
    return { granted: false, reason: 34, policy: null, account: `${domain.netbios}\\${account.sam}` }
  return { granted: false, reason: 16, policy: null, account: user.trim() }
}

export interface RadiusServerRef {
  /** Nom ou adresse du serveur NPS. */
  server: string
  sharedSecret: string
}

export interface RadiusOutcome {
  trace: PacketTrace
  /** Accès accordé, refusé, ou aucune réponse d'un serveur RADIUS. */
  result: 'accept' | 'reject' | 'timeout'
  reason: NpsReason
  account: string
  /** Événements à journaliser (serveur NPS). */
  events: { deviceId: string; event: NewEvent }[]
}

const isNps = (d: Device | undefined): d is ServerDevice =>
  d?.kind === 'server' && d.powered && d.host.features.includes('NPAS')

/**
 * Access-Request vers un serveur RADIUS puis réponse : décision du serveur NPS, ou null s'il
 * ne répond pas (injoignable, client inconnu, secret différent).
 */
function exchange(
  ctx: SimContext,
  nas: Device,
  ip: string,
  src: string,
  ref: RadiusServerRef,
  credentials: { user: string; password: string },
  events: RadiusOutcome['events']
): (NpsDecision & { account: string }) | null {
  const { state } = ctx
  const user = credentials.user.trim()
  const layers = (code: string): PduLayer[] => [
    { layer: 4, name: 'UDP', fields: [['Port destination', String(RADIUS_PORT)]] },
    {
      layer: 7,
      name: 'RADIUS',
      fields: [
        ['Code', code],
        ['User-Name', user],
        ['NAS-Identifier', nas.name]
      ]
    }
  ]
  const req = sendIp(ctx, nas.id, {
    src,
    dst: ip,
    ttl: initialTtl(nas),
    protocol: 'RADIUS',
    ipProtocol: '17 (UDP)',
    summary: `RADIUS Access-Request (${user})`,
    upper: layers('Access-Request'),
    transport: 'UDP',
    port: RADIUS_PORT
  })
  const nps = req.kind === 'delivered' ? state.devices[req.deviceId] : undefined
  if (req.kind !== 'delivered' || !isNps(nps)) return null

  // Le serveur NPS ignore les demandes d'un client inconnu ou signées avec un autre secret
  const client = npsOf(nps)?.radiusClients.find((c) => c.address === req.src)
  if (!client || client.sharedSecret !== ref.sharedSecret) {
    events.push({
      deviceId: nps.id,
      event: client
        ? {
            level: 'warning',
            source: 'NPS',
            eventId: 18,
            message: `Un message Access-Request a été reçu du client RADIUS ${client.name} (${req.src}) avec un attribut Message-Authenticator non valide : le secret partagé ne correspond pas.`
          }
        : {
            level: 'warning',
            source: 'NPS',
            eventId: 13,
            message: `Une demande RADIUS a été reçue d’un client RADIUS non valide. Adresse IP : ${req.src}.`
          }
    })
    return null
  }

  const decision = decide(state, nps, user, credentials.password)
  const details = `Utilisateur : ${decision.account}. Client RADIUS : ${client.name} (${client.address}). Stratégie réseau : ${decision.policy ?? '—'}.`
  events.push({
    deviceId: nps.id,
    event: decision.granted
      ? {
          level: 'information',
          source: 'Security-Auditing',
          eventId: 6272,
          log: 'Sécurité',
          message: `Le serveur NPS (Network Policy Server) a accordé l’accès à un utilisateur. ${details}`
        }
      : {
          level: 'warning',
          source: 'Security-Auditing',
          eventId: 6273,
          log: 'Sécurité',
          message: `Le serveur NPS (Network Policy Server) a refusé l’accès à un utilisateur. ${details} Code de raison : ${decision.reason}. Raison : ${NPS_REASONS[decision.reason as Exclude<NpsReason, 0>]}`
        }
  })
  const code = decision.granted ? 'Access-Accept' : 'Access-Reject'
  const reply = sendIp(ctx, nps.id, {
    src: ip,
    dst: req.src,
    ttl: initialTtl(nps),
    protocol: 'RADIUS',
    ipProtocol: '17 (UDP)',
    summary: `RADIUS ${code}`,
    upper: layers(code),
    reply: true
  })
  return reply.kind === 'delivered' ? decision : null
}

/**
 * Demande d'accès RADIUS du serveur d'accès `nasId` pour l'utilisateur : serveurs RADIUS
 * essayés dans l'ordre jusqu'à obtenir une réponse.
 */
export function radiusAuthenticate(
  state: LabState,
  nasId: string,
  servers: RadiusServerRef[],
  credentials: { user: string; password: string }
): RadiusOutcome {
  const traces: PacketTrace[] = []
  const events: RadiusOutcome['events'] = []
  const user = credentials.user.trim()
  const nas = state.devices[nasId]
  const outcome = (result: RadiusOutcome['result'], reason: NpsReason, account: string): RadiusOutcome => ({
    trace: concatTraces('RADIUS', traces),
    result,
    reason,
    account,
    events
  })
  if (!nas) return outcome('timeout', 0, user)

  for (const ref of servers) {
    let ip: string | null = ref.server
    if (!isIpv4(ref.server)) {
      const resolution = resolveName(state, nasId, ref.server)
      traces.push(resolution.trace)
      ip = firstAddress(resolution)
    }
    const src = ip ? sourceAddressFor(state, nas, ip) : null
    if (!ip || !src) continue
    const rec = createRecorder()
    const decision = exchange(createContext(state, rec), nas, ip, src, ref, credentials, events)
    traces.push({ title: 'RADIUS', events: rec.events })
    if (decision) return outcome(decision.granted ? 'accept' : 'reject', decision.reason, decision.account)
  }
  return outcome('timeout', 0, user)
}
