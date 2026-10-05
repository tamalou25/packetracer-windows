/**
 * Client DHCP : obtention (DORA), renouvellement et libération d'un bail.
 * Chaque échange est enregistré dans une trace rejouable en mode Simulation.
 */
import { logEvent } from '../core/eventlog'
import { transact } from '../core/result'
import type { DhcpScope, HostDevice, LabState, ServerDevice } from '../model/schema'
import { effectiveIpv4 } from '../net/addressing'
import { formatIpv4, inNetwork, parseIpv4, prefixToMask } from '../net/ipv4'
import { carrierUp, l2Segment, reversePath, type PortRef, type SegmentMember } from '../net/segment'
import { createContext, recordBroadcast, recordUnicast, type SimContext } from '../sim/forward'
import {
  BROADCAST_MAC,
  createRecorder,
  ethernetLayer,
  ipv4Layer,
  type PacketTrace,
  type PduLayer
} from '../sim/trace'
import { registerHostDns } from './adds/join'
import { effectiveOptions, inScopeRange, isExcluded, formatLeaseDuration } from './dhcp'

export type DhcpOutcome = 'bound' | 'renewed' | 'released' | 'failed' | 'not-dhcp' | 'no-carrier'

export interface DhcpOperation {
  state: LabState
  trace: PacketTrace
  outcome: DhcpOutcome
  address: string | null
  /** Message explicatif (échec). */
  message: string
}

function udpLayer(src: number, dst: number): PduLayer {
  return {
    layer: 4,
    name: 'UDP',
    fields: [
      ['Port source', String(src)],
      ['Port destination', String(dst)]
    ]
  }
}

function dhcpLayer(type: string, fields: [string, string][]): PduLayer {
  return { layer: 7, name: 'DHCP', fields: [['Type de message', type], ...fields] }
}

function hostFqdn(device: HostDevice): string {
  return device.host.domain ? `${device.name}.${device.host.domain}` : device.name
}

/** Le serveur DHCP est-il autorisé à distribuer des adresses ? */
export function dhcpAuthorized(server: ServerDevice): boolean {
  return !server.host.domain || !!server.services.dhcp?.authorized
}

/** Étendue active desservant le réseau sur lequel le serveur reçoit la requête. */
function scopeFor(server: ServerDevice, port: PortRef): DhcpScope | null {
  const iface = server.interfaces.find((i) => i.id === port.ifaceId)
  const eff = iface ? effectiveIpv4(iface) : null
  if (!eff || eff.source !== 'static' || !server.services.dhcp) return null
  return (
    server.services.dhcp.scopes.find(
      (s) => s.state === 'Active' && inNetwork(eff.address, s.scopeId, s.prefixLength)
    ) ?? null
  )
}

/** Adresse utilisée sur le segment par un autre hôte que le client. */
function inUse(state: LabState, serverPort: PortRef, clientMac: string, ip: string): boolean {
  return (
    l2Segment(state, serverPort).some((m) => {
      const iface = state.devices[m.port.deviceId]?.interfaces.find((i) => i.id === m.port.ifaceId)
      return !!iface && iface.mac !== clientMac && effectiveIpv4(iface)?.address === ip
    }) ||
    state.devices[serverPort.deviceId]?.interfaces.some((i) => effectiveIpv4(i)?.address === ip) === true
  )
}

interface Pick {
  ip: string | null
  /** Adresses détectées comme déjà utilisées (marquées BAD_ADDRESS). */
  bad: string[]
}

/** Choix de l'adresse à proposer (réservation, bail existant, adresse demandée, puis première libre). */
function pickAddress(
  state: LabState,
  scope: DhcpScope,
  serverPort: PortRef,
  mac: string,
  requested: string | null
): Pick {
  const reservation = scope.reservations.find((r) => r.mac === mac)
  if (reservation) return { ip: reservation.ip, bad: [] }
  const taken = new Set<string>([
    ...scope.reservations.filter((r) => r.mac !== mac).map((r) => r.ip),
    ...scope.leases.filter((l) => l.mac !== mac || l.state === 'BadAddress').map((l) => l.ip)
  ])
  const free = (ip: string) => inScopeRange(scope, ip) && !isExcluded(scope, ip) && !taken.has(ip)
  const bad: string[] = []
  const existing = scope.leases.find((l) => l.mac === mac && l.state === 'Active')
  for (const candidate of [existing?.ip, requested]) {
    if (candidate && free(candidate) && !inUse(state, serverPort, mac, candidate))
      return { ip: candidate, bad }
  }
  const start = parseIpv4(scope.start) ?? 0
  const end = parseIpv4(scope.end) ?? -1
  for (let v = start; v <= end; v++) {
    const ip = formatIpv4(v)
    if (!free(ip)) continue
    if (inUse(state, serverPort, mac, ip)) {
      bad.push(ip)
      continue
    }
    return { ip, bad }
  }
  return { ip: null, bad }
}

interface Chosen {
  member: SegmentMember
  server: ServerDevice
  scope: DhcpScope
  ip: string
  bad: string[]
}

function noChange(state: LabState, outcome: DhcpOutcome, message: string): DhcpOperation {
  return { state, trace: { title: 'DHCP', events: [] }, outcome, address: null, message }
}

function clientPort(state: LabState, clientId: string, ifaceId: string) {
  const client = state.devices[clientId]
  if (!client || (client.kind !== 'server' && client.kind !== 'client')) return null
  const iface = client.interfaces.find((i) => i.id === ifaceId)
  return iface ? { client, iface } : null
}

/**
 * Obtention d'un bail par diffusion (DHCPDISCOVER → OFFER → REQUEST → ACK).
 * `log` : journalise les anomalies côté serveur (désactivé pour les tentatives automatiques).
 */
export function dhcpAcquire(
  state: LabState,
  clientId: string,
  ifaceId: string,
  options: { log?: boolean } = {}
): DhcpOperation {
  const found = clientPort(state, clientId, ifaceId)
  if (!found) return noChange(state, 'failed', 'Carte introuvable.')
  const { client, iface } = found
  if (iface.addressing !== 'dhcp')
    return noChange(state, 'not-dhcp', `L’adaptateur ${iface.name} n’est pas activé pour DHCP.`)
  const origin: PortRef = { deviceId: clientId, ifaceId }
  if (!client.powered || !carrierUp(state, origin))
    return noChange(
      state,
      'no-carrier',
      `Aucune opération ne peut être effectuée sur ${iface.name} lorsque son média est déconnecté.`
    )

  const rec = createRecorder()
  const ctx: SimContext = createContext(state, rec)
  const xid = `0x${((state.seq * 2654435761) >>> 0).toString(16).padStart(8, '0')}`
  const requested = iface.dhcpLease?.address ?? null
  const title = `DHCP ${client.name} (${iface.name})`

  // Conteneur : la sélection est faite dans le rappel de diffusion
  const selection: { chosen: Chosen | null } = { chosen: null }
  const unauthorized: string[] = []
  const exhausted: { serverId: string; scopeId: string }[] = []

  recordBroadcast(
    ctx,
    origin,
    {
      protocol: 'DHCP',
      summary: `DHCP Discover (${iface.mac})`,
      layers: [
        ethernetLayer(iface.mac, BROADCAST_MAC, 'IPv4'),
        ipv4Layer('0.0.0.0', '255.255.255.255', 128, '17 (UDP)'),
        udpLayer(68, 67),
        dhcpLayer('DHCPDISCOVER', [
          ['Transaction', xid],
          ['MAC client', iface.mac],
          ['Adresse demandée', requested ?? '—'],
          ['Nom d’hôte', client.name]
        ])
      ]
    },
    (member) => {
      const dev = state.devices[member.port.deviceId]
      const name = dev?.name ?? '?'
      if (!dev || dev.kind !== 'server' || !dev.host.features.includes('DHCP') || !dev.services.dhcp)
        return { outcome: 'ignored', note: `${name} n’est pas un serveur DHCP : la diffusion est ignorée.` }
      const scope = scopeFor(dev, member.port)
      if (!dhcpAuthorized(dev)) {
        unauthorized.push(dev.id)
        return {
          outcome: 'dropped',
          note: `${name} n’est pas autorisé dans Active Directory : son service DHCP ne distribue aucune adresse.`
        }
      }
      if (!scope) {
        const portIface = dev.interfaces.find((i) => i.id === member.port.ifaceId)
        const eff = portIface ? effectiveIpv4(portIface) : null
        return {
          outcome: 'ignored',
          note:
            eff && eff.source !== 'static'
              ? `${name} n’écoute que sur ses cartes à adresse IP statique : la requête est ignorée.`
              : `${name} n’a aucune étendue active pour ce réseau : la requête est ignorée.`
        }
      }
      if (selection.chosen)
        return {
          outcome: 'delivered',
          note: `${name} pourrait répondre, mais le client retiendra la première offre reçue.`
        }
      const pick = pickAddress(state, scope, member.port, iface.mac, requested)
      if (!pick.ip) {
        exhausted.push({ serverId: dev.id, scopeId: scope.scopeId })
        return {
          outcome: 'dropped',
          note: `${name} n’a plus d’adresse disponible dans l’étendue ${scope.scopeId}.`
        }
      }
      selection.chosen = { member, server: dev, scope, ip: pick.ip, bad: pick.bad }
      return {
        outcome: 'delivered',
        note: `${name} dispose de l’étendue « ${scope.name} » : il réserve ${pick.ip} et prépare une offre.`
      }
    }
  )

  const pickResult = selection.chosen
  const logAnomalies = (draft: Parameters<Parameters<typeof transact>[1]>[0]) => {
    if (!options.log) return
    for (const id of new Set(unauthorized)) {
      const d = draft.devices[id]
      logEvent(draft, id, {
        level: 'error',
        source: 'DhcpServer',
        eventId: 1046,
        message: `Le service Serveur DHCP de l’ordinateur local, membre du domaine ${d && d.kind === 'server' ? d.host.domain : ''}, a déterminé qu’il n’est pas autorisé à démarrer. Il n’a servi aucun client.`
      })
    }
    for (const ex of exhausted) {
      logEvent(draft, ex.serverId, {
        level: 'warning',
        source: 'DhcpServer',
        eventId: 1063,
        message: `Aucune adresse IP n’est disponible pour un bail dans l’étendue ${ex.scopeId}.`
      })
    }
  }

  if (!pickResult) {
    const result = transact(state, (draft) => {
      const d = draft.devices[clientId]
      const target = d?.interfaces.find((i) => i.id === ifaceId)
      if (target) {
        target.dhcpLease = null
        target.dhcpReleased = false
      }
      logAnomalies(draft)
      return undefined
    })
    return {
      state: result.ok ? result.state : state,
      trace: { title, events: rec.events },
      outcome: 'failed',
      address: null,
      message: `Impossible de contacter votre serveur DHCP. Le délai d’attente de la demande a expiré.`
    }
  }

  const { member, server, scope, ip, bad } = pickResult
  const serverIface = server.interfaces.find((i) => i.id === member.port.ifaceId)
  const serverIp = serverIface ? (effectiveIpv4(serverIface)?.address ?? '') : ''
  const serverMac = serverIface?.mac ?? ''
  const opts = effectiveOptions(
    server.services.dhcp ?? {
      authorized: true,
      configured: true,
      scopes: [],
      serverOptions: { router: [], dnsServers: [], dnsDomain: null }
    },
    scope
  )
  const optionFields: [string, string][] = [
    ['Adresse proposée', ip],
    ['Masque (option 1)', prefixToMask(scope.prefixLength)],
    ['Routeur (option 003)', opts.router.join(', ') || '—'],
    ['Serveurs DNS (option 006)', opts.dnsServers.join(', ') || '—'],
    ['Domaine DNS (option 015)', opts.dnsDomain ?? '—'],
    ['Durée du bail', formatLeaseDuration(scope.leaseDurationSec)],
    ['Serveur DHCP', serverIp]
  ]
  const back = reversePath(member.path)
  recordUnicast(
    ctx,
    back,
    {
      protocol: 'DHCP',
      summary: `DHCP Offer ${ip} (de ${serverIp})`,
      layers: [
        ethernetLayer(serverMac, iface.mac, 'IPv4'),
        ipv4Layer(serverIp, '255.255.255.255', 128, '17 (UDP)'),
        udpLayer(67, 68),
        dhcpLayer('DHCPOFFER', [['Transaction', xid], ...optionFields])
      ]
    },
    'delivered',
    `${client.name} reçoit l’offre ${ip} de ${server.name}.`
  )
  recordBroadcast(
    ctx,
    origin,
    {
      protocol: 'DHCP',
      summary: `DHCP Request ${ip} (serveur ${serverIp})`,
      layers: [
        ethernetLayer(iface.mac, BROADCAST_MAC, 'IPv4'),
        ipv4Layer('0.0.0.0', '255.255.255.255', 128, '17 (UDP)'),
        udpLayer(68, 67),
        dhcpLayer('DHCPREQUEST', [
          ['Transaction', xid],
          ['Adresse demandée', ip],
          ['Identificateur du serveur', serverIp]
        ])
      ]
    },
    (m) => {
      const dev = state.devices[m.port.deviceId]
      if (dev && dev.id === server.id && m.port.ifaceId === member.port.ifaceId)
        return {
          outcome: 'delivered',
          note: `${dev.name} est le serveur choisi : il valide le bail de ${ip}.`
        }
      if (dev?.kind === 'server' && dev.host.features.includes('DHCP'))
        return {
          outcome: 'ignored',
          note: `${dev.name} n’a pas été choisi : il libère l’adresse qu’il avait réservée.`
        }
      return { outcome: 'ignored', note: `${dev?.name ?? '?'} ignore la requête DHCP.` }
    }
  )
  recordUnicast(
    ctx,
    back,
    {
      protocol: 'DHCP',
      summary: `DHCP Ack ${ip}`,
      layers: [
        ethernetLayer(serverMac, iface.mac, 'IPv4'),
        ipv4Layer(serverIp, ip, 128, '17 (UDP)'),
        udpLayer(67, 68),
        dhcpLayer('DHCPACK', [['Transaction', xid], ...optionFields])
      ]
    },
    'delivered',
    `${client.name} configure ${iface.name} : ${ip}/${scope.prefixLength}, passerelle ${opts.router[0] ?? 'aucune'}.`
  )

  const result = transact(state, (draft) => {
    const srv = draft.devices[server.id]
    const cli = draft.devices[clientId]
    if (
      !srv ||
      srv.kind !== 'server' ||
      !srv.services.dhcp ||
      !cli ||
      (cli.kind !== 'server' && cli.kind !== 'client')
    )
      return undefined
    const sc = srv.services.dhcp.scopes.find((s) => s.scopeId === scope.scopeId)
    if (!sc) return undefined
    const expiresAt = draft.clock + scope.leaseDurationSec * 1000
    for (const b of bad) {
      if (!sc.leases.some((l) => l.ip === b))
        sc.leases.push({ ip: b, mac: '', hostName: 'BAD_ADDRESS', expiresAt, state: 'BadAddress' })
    }
    sc.leases = sc.leases.filter((l) => !(l.mac === iface.mac && l.state === 'Active'))
    sc.leases.push({ ip, mac: iface.mac, hostName: hostFqdn(cli), expiresAt, state: 'Active' })
    const target = cli.interfaces.find((i) => i.id === ifaceId)
    if (target) {
      target.dhcpLease = {
        address: ip,
        prefixLength: scope.prefixLength,
        gateway: opts.router[0] ?? null,
        dnsServers: [...opts.dnsServers],
        dnsSuffix: opts.dnsDomain,
        serverId: serverIp,
        serverDeviceId: server.id,
        obtainedAt: draft.clock,
        expiresAt
      }
      target.dhcpReleased = false
    }
    // Un membre du domaine inscrit sa nouvelle adresse dans le DNS
    registerHostDns(draft, cli)
    logAnomalies(draft)
    return undefined
  })
  return {
    state: result.ok ? result.state : state,
    trace: { title, events: rec.events },
    outcome: 'bound',
    address: ip,
    message: ''
  }
}

/** ipconfig /renew : renouvellement unicast si le serveur du bail répond, sinon nouvelle découverte. */
export function dhcpRenew(state: LabState, clientId: string, ifaceId: string): DhcpOperation {
  const found = clientPort(state, clientId, ifaceId)
  if (!found) return noChange(state, 'failed', 'Carte introuvable.')
  const { client, iface } = found
  const lease = iface.dhcpLease
  if (iface.addressing !== 'dhcp' || !lease || iface.dhcpReleased)
    return dhcpAcquire(state, clientId, ifaceId, { log: true })
  const origin: PortRef = { deviceId: clientId, ifaceId }
  if (!client.powered || !carrierUp(state, origin))
    return dhcpAcquire(state, clientId, ifaceId, { log: true })
  const member = l2Segment(state, origin).find((m) => m.port.deviceId === lease.serverDeviceId)
  const server = state.devices[lease.serverDeviceId]
  const scope =
    server?.kind === 'server' && member
      ? server.services.dhcp?.scopes.find((s) =>
          s.leases.some((l) => l.mac === iface.mac && l.ip === lease.address && l.state === 'Active')
        )
      : undefined
  if (
    !member ||
    !server ||
    server.kind !== 'server' ||
    !scope ||
    !dhcpAuthorized(server) ||
    !server.powered ||
    scope.state !== 'Active'
  )
    return dhcpAcquire(state, clientId, ifaceId, { log: true })

  const rec = createRecorder()
  const ctx = createContext(state, rec)
  const serverIface = server.interfaces.find((i) => i.id === member.port.ifaceId)
  const serverMac = serverIface?.mac ?? ''
  recordUnicast(
    ctx,
    member.path,
    {
      protocol: 'DHCP',
      summary: `DHCP Request (renouvellement de ${lease.address})`,
      layers: [
        ethernetLayer(iface.mac, serverMac, 'IPv4'),
        ipv4Layer(lease.address, lease.serverId, 128, '17 (UDP)'),
        udpLayer(68, 67),
        dhcpLayer('DHCPREQUEST', [['Adresse client', lease.address]])
      ]
    },
    'delivered',
    `${server.name} retrouve le bail de ${lease.address} et le prolonge.`
  )
  recordUnicast(
    ctx,
    reversePath(member.path),
    {
      protocol: 'DHCP',
      summary: `DHCP Ack ${lease.address}`,
      layers: [
        ethernetLayer(serverMac, iface.mac, 'IPv4'),
        ipv4Layer(lease.serverId, lease.address, 128, '17 (UDP)'),
        udpLayer(67, 68),
        dhcpLayer('DHCPACK', [
          ['Adresse', lease.address],
          ['Durée du bail', formatLeaseDuration(scope.leaseDurationSec)]
        ])
      ]
    },
    'delivered',
    `${client.name} conserve ${lease.address} pour une nouvelle durée de bail.`
  )
  const result = transact(state, (draft) => {
    const srv = draft.devices[server.id]
    const cli = draft.devices[clientId]
    const expiresAt = draft.clock + scope.leaseDurationSec * 1000
    if (srv?.kind === 'server') {
      const l = srv.services.dhcp?.scopes
        .find((s) => s.scopeId === scope.scopeId)
        ?.leases.find((x) => x.mac === iface.mac)
      if (l) l.expiresAt = expiresAt
    }
    const target = cli?.interfaces.find((i) => i.id === ifaceId)
    if (target?.dhcpLease) {
      target.dhcpLease.obtainedAt = draft.clock
      target.dhcpLease.expiresAt = expiresAt
      // Les options peuvent avoir changé côté serveur
      const opts =
        srv?.kind === 'server' && srv.services.dhcp ? effectiveOptions(srv.services.dhcp, scope) : null
      if (opts) {
        target.dhcpLease.gateway = opts.router[0] ?? null
        target.dhcpLease.dnsServers = [...opts.dnsServers]
        target.dhcpLease.dnsSuffix = opts.dnsDomain
      }
    }
    return undefined
  })
  return {
    state: result.ok ? result.state : state,
    trace: { title: `DHCP ${client.name} (renouvellement)`, events: rec.events },
    outcome: 'renewed',
    address: lease.address,
    message: ''
  }
}

/** ipconfig /release : rend le bail au serveur ; la carte n'a plus d'adresse IPv4. */
export function dhcpRelease(state: LabState, clientId: string, ifaceId: string): DhcpOperation {
  const found = clientPort(state, clientId, ifaceId)
  if (!found) return noChange(state, 'failed', 'Carte introuvable.')
  const { client, iface } = found
  const lease = iface.dhcpLease
  const rec = createRecorder()
  if (lease) {
    const origin: PortRef = { deviceId: clientId, ifaceId }
    const member = carrierUp(state, origin)
      ? l2Segment(state, origin).find((m) => m.port.deviceId === lease.serverDeviceId)
      : undefined
    if (member) {
      const ctx = createContext(state, rec)
      const serverMac =
        state.devices[member.port.deviceId]?.interfaces.find((i) => i.id === member.port.ifaceId)?.mac ?? ''
      recordUnicast(
        ctx,
        member.path,
        {
          protocol: 'DHCP',
          summary: `DHCP Release ${lease.address}`,
          layers: [
            ethernetLayer(iface.mac, serverMac, 'IPv4'),
            ipv4Layer(lease.address, lease.serverId, 128, '17 (UDP)'),
            udpLayer(68, 67),
            dhcpLayer('DHCPRELEASE', [['Adresse libérée', lease.address]])
          ]
        },
        'delivered',
        `Le serveur supprime le bail de ${lease.address} : l’adresse redevient disponible.`
      )
    }
  }
  const result = transact(state, (draft) => {
    const srv = lease ? draft.devices[lease.serverDeviceId] : undefined
    if (srv?.kind === 'server' && srv.services.dhcp) {
      for (const sc of srv.services.dhcp.scopes)
        sc.leases = sc.leases.filter((l) => !(l.mac === iface.mac && l.state === 'Active'))
    }
    const target = draft.devices[clientId]?.interfaces.find((i) => i.id === ifaceId)
    if (target) {
      target.dhcpLease = null
      target.dhcpReleased = true
    }
    return undefined
  })
  return {
    state: result.ok ? result.state : state,
    trace: { title: `DHCP ${client.name} (libération)`, events: rec.events },
    outcome: 'released',
    address: null,
    message: ''
  }
}

/**
 * Configuration automatique : les cartes en DHCP sans bail (et non libérées manuellement)
 * tentent d'obtenir une adresse, comme le fait le client DHCP en tâche de fond.
 */
export function autoConfigureDhcp(state: LabState): { state: LabState; traces: PacketTrace[] } {
  let current = state
  const traces: PacketTrace[] = []
  for (const device of Object.values(state.devices)) {
    if ((device.kind !== 'server' && device.kind !== 'client') || !device.powered) continue
    for (const iface of device.interfaces) {
      if (iface.addressing !== 'dhcp' || iface.dhcpLease || iface.dhcpReleased || !iface.enabled) continue
      if (!carrierUp(current, { deviceId: device.id, ifaceId: iface.id })) continue
      const op = dhcpAcquire(current, device.id, iface.id)
      if (op.outcome === 'bound') {
        current = op.state
        traces.push(op.trace)
      }
    }
  }
  return { state: current, traces }
}
