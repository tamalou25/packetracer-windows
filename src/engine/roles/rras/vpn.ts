/**
 * Client VPN (Paramètres > Réseau > VPN, Add-VpnConnection, rasdial) : connexion tracée au
 * serveur RRAS (SSTP, TCP 443), authentification, adresse attribuée par le pool du serveur.
 */
import type { Draft } from 'immer'
import { logEvent, type NewEvent } from '../../core/eventlog'
import { raise, transact, type EngineResult } from '../../core/result'
import type { HostDevice, LabState, ServerDevice } from '../../model/schema'
import { effectiveIpv4 } from '../../net/addressing'
import type { PacketTrace } from '../../sim/trace'
import { concatTraces } from '../../sim/trace'
import { requireDevice } from '../../topology/actions'
import { authenticate } from '../adds/credentials'
import { serverExchange } from '../adds/locator'
import { firstAddress, resolveName } from '../dns/resolver'
import { radiusAuthenticate } from '../nps/radius'
import { freePoolAddress } from './actions'
import { ensureRoleState } from '../state'
import { RRAS_STATE, rrasOf, vpnEnabled } from './state'

export const VPN_UNREACHABLE =
  'Erreur 800 : impossible d’établir la connexion VPN. Le serveur VPN est peut-être inaccessible ou le protocole de tunnel n’est pas accepté.'
export const VPN_BAD_CREDENTIALS =
  'Erreur 691 : la connexion à distance a été refusée, car la combinaison nom d’utilisateur / mot de passe fournie n’est pas reconnue, ou le protocole d’authentification sélectionné n’est pas autorisé sur le serveur d’accès à distance.'
/** Aucun serveur RADIUS n'a répondu (le serveur VPN journalise l'événement 20073). */
export const VPN_RADIUS_TIMEOUT =
  'La connexion à distance a été refusée : le serveur VPN n’a obtenu aucune réponse du serveur d’authentification RADIUS.'
export const VPN_NO_ADDRESS =
  'Erreur 720 : aucune adresse ne peut être attribuée : le pool d’adresses du serveur VPN est épuisé.'

function requireHost(draft: Draft<LabState>, deviceId: string): Draft<HostDevice> {
  const device = requireDevice(draft, deviceId)
  if (device.kind !== 'server' && device.kind !== 'client')
    raise('NotSupported', 'Une connexion VPN se configure sur un serveur ou un poste.')
  return device
}

/** Ajoute une connexion VPN (nom, serveur). */
export function addVpnConnection(
  state: LabState,
  deviceId: string,
  input: { name: string; server: string }
): EngineResult {
  return transact(state, (draft) => {
    const host = requireHost(draft, deviceId)
    const name = input.name.trim()
    const server = input.server.trim()
    if (!name) raise('InvalidName', 'Indiquez le nom de la connexion.')
    if (!server) raise('InvalidServer', 'Indiquez le nom ou l’adresse du serveur VPN.')
    if (host.host.vpnConnections.some((c) => c.name.toLowerCase() === name.toLowerCase()))
      raise('VpnExists', `Une connexion VPN nommée « ${name} » existe déjà.`)
    host.host.vpnConnections.push({ name, server, connected: null })
    return undefined
  })
}

/** Supprime une connexion VPN (déconnectée). */
export function removeVpnConnection(state: LabState, deviceId: string, name: string): EngineResult {
  return transact(state, (draft) => {
    const host = requireHost(draft, deviceId)
    const index = host.host.vpnConnections.findIndex(
      (c) => c.name.toLowerCase() === name.trim().toLowerCase()
    )
    if (index < 0) raise('VpnNotFound', `La connexion VPN « ${name} » est introuvable.`)
    if (host.host.vpnConnections[index]?.connected)
      raise('VpnConnected', 'Déconnectez la connexion VPN avant de la supprimer.')
    host.host.vpnConnections.splice(index, 1)
    return undefined
  })
}

export interface VpnOutcome {
  state: LabState
  trace: PacketTrace
  ok: boolean
  message: string
  /** Adresse attribuée par le serveur. */
  address: string | null
}

/** Établit la connexion VPN : tunnel SSTP vers le serveur, authentification, adresse du pool. */
export function vpnConnect(
  state: LabState,
  clientId: string,
  name: string,
  credentials: { user: string; password: string }
): VpnOutcome {
  const traces: PacketTrace[] = []
  const done = (ok: boolean, message: string, next = state, address: string | null = null): VpnOutcome => ({
    state: next,
    trace: concatTraces(`VPN ${name}`, traces),
    ok,
    message,
    address
  })
  const client = state.devices[clientId]
  if (!client || (client.kind !== 'server' && client.kind !== 'client') || !client.powered)
    return done(false, 'Ordinateur introuvable.')
  const conn = client.host.vpnConnections.find((c) => c.name.toLowerCase() === name.trim().toLowerCase())
  if (!conn) return done(false, `La connexion VPN « ${name} » est introuvable.`)
  if (conn.connected) return done(false, `La connexion « ${conn.name} » est déjà établie.`)

  let ip: string | null = conn.server
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(conn.server)) {
    const resolution = resolveName(state, clientId, conn.server)
    traces.push(resolution.trace)
    ip = firstAddress(resolution)
  }
  if (!ip) return done(false, VPN_UNREACHABLE)
  const server = Object.values(state.devices).find(
    (d): d is ServerDevice =>
      d.kind === 'server' && d.powered && d.interfaces.some((i) => effectiveIpv4(i)?.address === ip)
  )
  const rras = server ? rrasOf(server) : null
  const listening = !!server && vpnEnabled(rras)
  const exchange = serverExchange(state, clientId, ip, {
    protocol: 'VPN',
    port: 443,
    request: 'SSTP : demande d’établissement du tunnel',
    reply: listening ? 'SSTP : tunnel établi, authentification' : 'TCP RST',
    fields: [['Serveur VPN', conn.server]]
  })
  traces.push(exchange.trace)
  if (!exchange.ok || !server || !rras || !listening) return done(false, VPN_UNREACHABLE)

  // Authentification : serveurs RADIUS (NPS) s'il y en a, sinon authentification Windows
  const pending: { deviceId: string; event: NewEvent }[] = []
  let account = credentials.user.trim()
  let failure: string | null = null
  if (rras.radius.length > 0) {
    const radius = radiusAuthenticate(state, server.id, rras.radius, credentials)
    traces.push(radius.trace)
    pending.push(...radius.events)
    account = radius.account
    if (radius.result === 'reject') failure = VPN_BAD_CREDENTIALS
    if (radius.result === 'timeout') {
      failure = VPN_RADIUS_TIMEOUT
      pending.push({
        deviceId: server.id,
        event: {
          level: 'warning',
          source: 'RemoteAccess',
          eventId: 20073,
          message: 'Le serveur d’authentification n’a pas répondu à temps aux demandes d’authentification.'
        }
      })
    }
  } else {
    const token = authenticate(state, server, credentials.user, credentials.password)
    if (token) account = token.account
    else failure = VPN_BAD_CREDENTIALS
  }
  const address = failure ? null : freePoolAddress(rras)
  if (!failure && !address) failure = VPN_NO_ADDRESS
  if (failure || !address) {
    const message = failure ?? VPN_NO_ADDRESS
    const r = transact(state, (draft) => {
      for (const p of pending) logEvent(draft, p.deviceId, p.event)
      logEvent(draft, server.id, {
        level: 'warning',
        source: 'RemoteAccess',
        eventId: 20271,
        message: `L’utilisateur ${account} s’est connecté depuis ${exchange.src ?? client.name}, mais a échoué lors d’une tentative d’authentification pour la raison suivante : ${message}`
      })
      return undefined
    })
    return done(false, message, r.ok ? r.state : state)
  }
  const clientAddress = exchange.src ?? ''

  const r = transact(state, (draft) => {
    for (const p of pending) logEvent(draft, p.deviceId, p.event)
    const srv = draft.devices[server.id] as Draft<ServerDevice>
    ensureRoleState(srv, RRAS_STATE).sessions.push({
      clientDeviceId: clientId,
      user: account,
      address,
      clientAddress,
      connectedAt: draft.clock
    })
    const host = draft.devices[clientId] as Draft<HostDevice>
    const c = host.host.vpnConnections.find((x) => x.name === conn.name)
    if (c)
      c.connected = {
        address,
        serverDeviceId: server.id,
        serverAddress: ip,
        clientAddress,
        user: account
      }
    logEvent(draft, server.id, {
      level: 'information',
      source: 'RemoteAccess',
      eventId: 20274,
      message: `L’utilisateur ${account} s’est connecté depuis ${client.name} ; adresse attribuée : ${address}.`
    })
    return undefined
  })
  if (!r.ok) return done(false, r.error.message)
  return done(true, '', r.state, address)
}

/** Ferme la connexion VPN (rasdial /disconnect). */
export function vpnDisconnect(state: LabState, clientId: string, name: string): EngineResult {
  return transact(state, (draft) => {
    const host = requireHost(draft, clientId)
    const conn = host.host.vpnConnections.find((c) => c.name.toLowerCase() === name.trim().toLowerCase())
    if (!conn) raise('VpnNotFound', `La connexion VPN « ${name} » est introuvable.`)
    if (!conn.connected) raise('VpnNotConnected', 'Aucune connexion.')
    const srv = draft.devices[conn.connected.serverDeviceId]
    const rras = srv?.kind === 'server' ? rrasOf(srv as ServerDevice) : null
    if (srv?.kind === 'server' && rras)
      ensureRoleState(srv, RRAS_STATE).sessions = rras.sessions.filter((s) => s.clientDeviceId !== clientId)
    conn.connected = null
    return undefined
  })
}
