/**
 * Localisation d'un contrôleur de domaine par un client (enregistrement SRV dans le DNS,
 * « ping » LDAP) et échanges applicatifs tracés avec un serveur (LDAP, Kerberos, SMB).
 */
import type { Domain, LabState } from '../../model/schema'
import { effectiveIpv4 } from '../../net/addressing'
import { initialTtl } from '../../net/routing'
import { createContext, sendIp, sourceAddressFor } from '../../sim/forward'
import { createRecorder, type PacketTrace, type PduLayer, type Protocol } from '../../sim/trace'
import { normalizeName } from '../dns'
import { firstAddress, resolveName } from '../dns-resolver'

/** Contrôleur de domaine localisé par le client. */
export interface LocatedDc {
  domain: Domain
  dcId: string
  dcIp: string
}

/** Échange applicatif à tracer entre un client et un serveur (LDAP, Kerberos, SMB). */
export interface ExchangeSpec {
  protocol: Protocol
  port: number
  request: string
  reply: string
  fields: [string, string][]
}

const APPLICATION_LAYER: Partial<Record<Protocol, string>> = {
  LDAP: 'LDAP',
  KERBEROS: 'Kerberos',
  SMB: 'SMB2'
}

/**
 * Requête puis réponse entre un client et un serveur, routées comme de vrais paquets.
 * Kerberos (88), SMB (445) et LDAP (389 hors « ping » de localisation) passent par TCP.
 */
export function serverExchange(
  state: LabState,
  fromId: string,
  dstIp: string,
  spec: ExchangeSpec
): { trace: PacketTrace; ok: boolean } {
  const { protocol, port, request, reply, fields } = spec
  const rec = createRecorder()
  const ctx = createContext(state, rec)
  const from = state.devices[fromId]
  const src = from ? sourceAddressFor(state, from, dstIp) : null
  if (!from || !src) return { trace: { title: protocol, events: [] }, ok: false }
  const tcp = port !== 389 || !request.startsWith('LDAP ping')
  const layer = (kind: string): PduLayer[] => [
    { layer: 4, name: tcp ? 'TCP' : 'UDP', fields: [['Port destination', String(port)]] },
    { layer: 7, name: APPLICATION_LAYER[protocol] ?? protocol, fields: [['Message', kind], ...fields] }
  ]
  const ipProtocol = tcp ? '6 (TCP)' : '17 (UDP)'
  const req = sendIp(ctx, fromId, {
    src,
    dst: dstIp,
    ttl: initialTtl(from),
    protocol,
    ipProtocol,
    summary: request,
    upper: layer(request)
  })
  if (req.kind !== 'delivered') return { trace: { title: protocol, events: rec.events }, ok: false }
  const dc = state.devices[req.deviceId]
  if (!dc) return { trace: { title: protocol, events: rec.events }, ok: false }
  const rep = sendIp(ctx, dc.id, {
    src: dstIp,
    dst: src,
    ttl: initialTtl(dc),
    protocol,
    ipProtocol,
    summary: reply,
    upper: layer(reply)
  })
  return { trace: { title: protocol, events: rec.events }, ok: rep.kind === 'delivered' }
}

export function exchange(
  state: LabState,
  fromId: string,
  dstIp: string,
  protocol: Protocol,
  port: number,
  request: string,
  reply: string,
  fields: [string, string][]
): { trace: PacketTrace; ok: boolean } {
  return serverExchange(state, fromId, dstIp, { protocol, port, request, reply, fields })
}

/** Localise un contrôleur du domaine via le DNS du client puis le contacte (ping LDAP). */
export function locateDc(
  state: LabState,
  clientId: string,
  domainName: string,
  traces: PacketTrace[]
): LocatedDc | null {
  const srv = resolveName(state, clientId, `_ldap._tcp.dc._msdcs.${domainName}`, 'SRV')
  traces.push(srv.trace)
  if (srv.result.kind !== 'answer') return null
  const target = srv.result.records.find((r) => r.type === 'SRV')?.data.split(' ')[3]
  if (!target) return null
  const a = resolveName(state, clientId, normalizeName(target), 'A')
  traces.push(a.trace)
  const dcIp = firstAddress(a)
  if (!dcIp) return null
  const dc = Object.values(state.devices).find(
    (d) => d.powered && d.interfaces.some((i) => effectiveIpv4(i)?.address === dcIp)
  )
  const domain = Object.values(state.domains).find(
    (d) => d.name === normalizeName(domainName) || d.netbios.toLowerCase() === domainName.toLowerCase()
  )
  if (!dc || !domain || !domain.controllers.includes(dc.id)) return null
  const ldap = exchange(
    state,
    clientId,
    dcIp,
    'LDAP',
    389,
    'LDAP ping (recherche du DC)',
    'LDAP réponse : contrôleur disponible',
    [['Domaine', domain.name]]
  )
  traces.push(ldap.trace)
  return ldap.ok ? { domain, dcId: dc.id, dcIp } : null
}
