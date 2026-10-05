/**
 * Postes et serveurs membres : jonction au domaine, ouverture de session, inscription DNS.
 * La localisation du contrôleur de domaine passe par le DNS (enregistrement SRV) :
 * un poste dont le DNS ne pointe pas vers le DC ne peut pas joindre le domaine.
 */
import type { Draft } from 'immer'
import { logEvent } from '../../core/eventlog'
import { transact } from '../../core/result'
import type { Domain, HostDevice, LabState } from '../../model/schema'
import { effectiveIpv4 } from '../../net/addressing'
import { isApipa } from '../../net/ipv4'
import { initialTtl } from '../../net/routing'
import { createContext, sendIp, sourceAddressFor } from '../../sim/forward'
import { concatTraces, createRecorder, type PacketTrace, type PduLayer, type Protocol } from '../../sim/trace'
import { normalizeName, ptrQueryName } from '../dns'
import { dnsServersOf, firstAddress, resolveName } from '../dns-resolver'
import {
  defaultContainer,
  findPrincipal,
  newAdId,
  passwordMeetsPolicy,
  PASSWORD_POLICY_ERROR,
  resolveContainerDn
} from './directory'

export interface DirectoryOperation {
  state: LabState
  trace: PacketTrace
  ok: boolean
  message: string
}

/** Contrôleur de domaine localisé par le client. */
interface LocatedDc {
  domain: Domain
  dcId: string
  dcIp: string
}

function exchange(
  state: LabState,
  fromId: string,
  dstIp: string,
  protocol: Protocol,
  port: number,
  request: string,
  reply: string,
  fields: [string, string][]
): { trace: PacketTrace; ok: boolean } {
  const rec = createRecorder()
  const ctx = createContext(state, rec)
  const from = state.devices[fromId]
  const src = from ? sourceAddressFor(state, from, dstIp) : null
  if (!from || !src) return { trace: { title: protocol, events: [] }, ok: false }
  const layer = (kind: string): PduLayer[] => [
    { layer: 4, name: port === 88 ? 'TCP' : 'UDP', fields: [['Port destination', String(port)]] },
    { layer: 7, name: protocol === 'LDAP' ? 'LDAP' : 'Kerberos', fields: [['Message', kind], ...fields] }
  ]
  const req = sendIp(ctx, fromId, {
    src,
    dst: dstIp,
    ttl: initialTtl(from),
    protocol,
    ipProtocol: port === 88 ? '6 (TCP)' : '17 (UDP)',
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
    ipProtocol: port === 88 ? '6 (TCP)' : '17 (UDP)',
    summary: reply,
    upper: layer(reply)
  })
  return { trace: { title: protocol, events: rec.events }, ok: rep.kind === 'delivered' }
}

/** Localise un contrôleur du domaine via le DNS du client puis le contacte (ping LDAP). */
function locateDc(
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

/** Nom d'ouverture de session sans domaine (LAB\jdupont, jdupont@lab.local → jdupont). */
export function accountName(user: string): string {
  const u = user.trim()
  if (u.includes('\\')) return u.split('\\')[1] ?? u
  if (u.includes('@')) return u.split('@')[0] ?? u
  return u
}

function hostOf(state: LabState, id: string): HostDevice | null {
  const d = state.devices[id]
  return d && (d.kind === 'server' || d.kind === 'client') ? d : null
}

export interface JoinInput {
  domain: string
  user: string
  password: string
  ouPath?: string
}

/** Jonction d'un ordinateur au domaine (Add-Computer / Propriétés système). */
export function joinDomain(state: LabState, deviceId: string, input: JoinInput): DirectoryOperation {
  const host = hostOf(state, deviceId)
  const empty: PacketTrace = { title: 'Jonction au domaine', events: [] }
  if (!host || !host.powered) return { state, trace: empty, ok: false, message: 'L’ordinateur est éteint.' }
  const domainName = normalizeName(input.domain)
  const fail = (reason: string, traces: PacketTrace[] = []): DirectoryOperation => ({
    state,
    trace: concatTraces(`Jonction de ${host.name} au domaine ${domainName}`, traces),
    ok: false,
    message: `L’ordinateur « ${host.name} » n’a pas pu joindre le domaine « ${domainName} » à partir de son groupe de travail actuel « ${host.host.workgroup} » avec l’erreur suivante : ${reason}`
  })
  if (host.host.domain === domainName || host.host.pendingDomain === domainName)
    return {
      state,
      trace: empty,
      ok: false,
      message: `L’ordinateur « ${host.name} » est déjà membre du domaine « ${domainName} ».`
    }
  if (Object.values(state.domains).some((d) => d.controllers.includes(deviceId)))
    return {
      state,
      trace: empty,
      ok: false,
      message: 'Un contrôleur de domaine ne peut pas changer de domaine.'
    }

  const traces: PacketTrace[] = []
  const located = locateDc(state, deviceId, domainName, traces)
  if (!located) return fail('Le domaine spécifié n’existe pas ou n’a pas pu être contacté.', traces)

  const sam = accountName(input.user)
  const principal = findPrincipal(located.domain, sam)
  const user = principal?.kind === 'user' ? principal.obj : null
  const credentialsOk = !!user && user.enabled && user.password === input.password
  const kerberos = exchange(
    state,
    deviceId,
    located.dcIp,
    'KERBEROS',
    88,
    `Kerberos AS-REQ (${located.domain.netbios}\\${sam})`,
    credentialsOk ? 'Kerberos AS-REP (ticket accordé)' : 'Kerberos KRB-ERROR (pré-authentification refusée)',
    [['Compte', `${sam}@${located.domain.name.toUpperCase()}`]]
  )
  traces.push(kerberos.trace)
  if (!user || user.password !== input.password)
    return fail('Nom d’utilisateur ou mot de passe incorrect.', traces)
  if (!user.enabled)
    return fail('Le compte référencé est actuellement désactivé et ne peut pas être utilisé.', traces)

  let parentId: string | null | undefined = defaultContainer(located.domain, 'Computers')
  if (input.ouPath) {
    parentId = resolveContainerDn(located.domain, input.ouPath)
    if (parentId === undefined || parentId === null)
      return fail(`Le chemin d’unité d’organisation « ${input.ouPath} » est introuvable.`, traces)
  }

  const result = transact(state, (draft) => {
    const domain = draft.domains[located.domain.name] as Draft<Domain>
    const device = draft.devices[deviceId] as Draft<HostDevice>
    const computerName = device.host.pendingName ?? device.name
    const computer = domain.computers.find((c) => c.name.toLowerCase() === computerName.toLowerCase())
    if (computer) {
      computer.deviceId = deviceId
      computer.enabled = true
    } else {
      const id = newAdId(draft)
      domain.computers.push({
        id,
        name: computerName,
        parentId: parentId as string,
        deviceId,
        enabled: true,
        dnsHostName: `${computerName.toLowerCase()}.${domain.name}`
      })
      domain.groups.find((g) => g.name === 'Ordinateurs du domaine')?.members.push(id)
    }
    device.host.pendingDomain = domain.name
    device.host.pendingReboot = true
    logEvent(draft, located.dcId, {
      level: 'information',
      source: 'Security-Auditing',
      eventId: 4741,
      log: 'Sécurité',
      message: `Un compte d’ordinateur a été créé : ${domain.netbios}\\${computerName}$ (par ${domain.netbios}\\${sam}).`
    })
    return undefined
  })
  return {
    state: result.ok ? result.state : state,
    trace: concatTraces(`Jonction de ${host.name} au domaine ${domainName}`, traces),
    ok: true,
    message: `Bienvenue dans le domaine ${domainName}. Vous devez redémarrer l’ordinateur pour appliquer ces modifications.`
  }
}

/** Quitte le domaine (retour en groupe de travail au prochain redémarrage). */
export function leaveDomain(state: LabState, deviceId: string): DirectoryOperation {
  const empty: PacketTrace = { title: 'Groupe de travail', events: [] }
  const result = transact(state, (draft) => {
    const device = draft.devices[deviceId]
    if (!device || (device.kind !== 'server' && device.kind !== 'client') || !device.host.domain) return false
    device.host.pendingDomain = ''
    device.host.pendingReboot = true
    return true
  })
  if (!result.ok || !result.value)
    return { state, trace: empty, ok: false, message: 'Cet ordinateur n’est membre d’aucun domaine.' }
  return {
    state: result.state,
    trace: empty,
    ok: true,
    message:
      'Bienvenue dans le groupe de travail WORKGROUP. Redémarrez l’ordinateur pour appliquer la modification.'
  }
}

export interface LogonInput {
  user: string
  password: string
  /** Nom NetBIOS du domaine, ou null pour un compte local. */
  domain: string | null
}

export type LogonOutcome = DirectoryOperation & { mustChangePassword?: boolean }

/** Ouverture de session interactive (écran de connexion). */
export function logon(state: LabState, deviceId: string, input: LogonInput): LogonOutcome {
  const host = hostOf(state, deviceId)
  const empty: PacketTrace = { title: 'Ouverture de session', events: [] }
  const incorrect = 'Le nom d’utilisateur ou le mot de passe est incorrect.'
  if (!host || !host.powered) return { state, trace: empty, ok: false, message: 'L’ordinateur est éteint.' }
  const sam = accountName(input.user)

  // Compte local
  if (!input.domain || input.domain.toUpperCase() === host.name.toUpperCase()) {
    const localOk =
      (sam.toLowerCase() === 'administrateur' && input.password === host.host.localAdminPassword) ||
      (host.kind === 'client' && sam.toLowerCase() === 'utilisateur' && input.password === '')
    if (!localOk) return { state, trace: empty, ok: false, message: incorrect }
    const r = transact(state, (draft) => {
      const d = draft.devices[deviceId] as Draft<HostDevice>
      d.host.session = {
        user: sam.toLowerCase() === 'administrateur' ? 'Administrateur' : 'Utilisateur',
        domain: null
      }
      return undefined
    })
    return { state: r.ok ? r.state : state, trace: empty, ok: true, message: '' }
  }

  const domain = Object.values(state.domains).find(
    (d) => d.netbios.toUpperCase() === input.domain?.toUpperCase() || d.name === input.domain?.toLowerCase()
  )
  if (!host.host.domain || !domain || domain.name !== host.host.domain)
    return {
      state,
      trace: empty,
      ok: false,
      message: 'Le domaine spécifié n’existe pas ou n’a pas pu être contacté.'
    }
  const traces: PacketTrace[] = []
  const located = locateDc(state, deviceId, domain.name, traces)
  if (!located)
    return {
      state,
      trace: concatTraces('Ouverture de session', traces),
      ok: false,
      message:
        'Il n’y a actuellement aucun serveur d’accès disponible pour traiter la demande d’ouverture de session.'
    }
  const principal = findPrincipal(domain, sam)
  const user = principal?.kind === 'user' ? principal.obj : null
  const good = !!user && user.password === input.password
  const kerberos = exchange(
    state,
    deviceId,
    located.dcIp,
    'KERBEROS',
    88,
    `Kerberos AS-REQ (${domain.netbios}\\${sam})`,
    good && user?.enabled ? 'Kerberos AS-REP (TGT accordé)' : 'Kerberos KRB-ERROR',
    [['Compte', `${sam}@${domain.name.toUpperCase()}`]]
  )
  traces.push(kerberos.trace)
  const trace = concatTraces(`Ouverture de session ${domain.netbios}\\${sam}`, traces)
  const audit = (draft: Draft<LabState>, ok: boolean) =>
    logEvent(draft, located.dcId, {
      level: ok ? 'information' : 'warning',
      source: 'Security-Auditing',
      eventId: ok ? 4768 : 4771,
      log: 'Sécurité',
      message: ok
        ? `Un ticket d’authentification Kerberos (TGT) a été demandé pour ${domain.netbios}\\${sam} depuis ${host.name}.`
        : `La pré-authentification Kerberos a échoué pour le compte ${sam} depuis ${host.name}.`
    })
  if (!user || !good) {
    const r = transact(state, (draft) => {
      audit(draft, false)
      logEvent(draft, deviceId, {
        level: 'warning',
        source: 'Security-Auditing',
        eventId: 4625,
        log: 'Sécurité',
        message: `Échec d’ouverture de session pour ${domain.netbios}\\${sam}.`
      })
      return undefined
    })
    return { state: r.ok ? r.state : state, trace, ok: false, message: incorrect }
  }
  if (!user.enabled)
    return {
      state,
      trace,
      ok: false,
      message: 'Votre compte a été désactivé. Contactez votre administrateur système.'
    }
  if (user.mustChangePassword)
    return {
      state,
      trace,
      ok: false,
      mustChangePassword: true,
      message: 'Vous devez changer votre mot de passe avant d’ouvrir une session pour la première fois.'
    }
  const r = transact(state, (draft) => {
    const d = draft.devices[deviceId] as Draft<HostDevice>
    d.host.session = { user: user.sam, domain: domain.netbios }
    audit(draft, true)
    logEvent(draft, deviceId, {
      level: 'information',
      source: 'Security-Auditing',
      eventId: 4624,
      log: 'Sécurité',
      message: `Ouverture de session réussie : ${domain.netbios}\\${user.sam}.`
    })
    return undefined
  })
  return { state: r.ok ? r.state : state, trace, ok: true, message: '' }
}

/** Changement du mot de passe imposé à la première ouverture de session, puis connexion. */
export function changePasswordAndLogon(
  state: LabState,
  deviceId: string,
  input: LogonInput & { newPassword: string }
): LogonOutcome {
  const domain = Object.values(state.domains).find(
    (d) => d.netbios.toUpperCase() === input.domain?.toUpperCase()
  )
  const empty: PacketTrace = { title: 'Changement de mot de passe', events: [] }
  if (!domain) return { state, trace: empty, ok: false, message: 'Domaine introuvable.' }
  const sam = accountName(input.user)
  const user = domain.users.find((u) => u.sam.toLowerCase() === sam.toLowerCase())
  if (!user || user.password !== input.password)
    return {
      state,
      trace: empty,
      ok: false,
      message: 'Le nom d’utilisateur ou le mot de passe est incorrect.'
    }
  if (!passwordMeetsPolicy(input.newPassword, sam))
    return { state, trace: empty, ok: false, message: PASSWORD_POLICY_ERROR }
  const r = transact(state, (draft) => {
    const u = draft.domains[domain.name]?.users.find((x) => x.id === user.id)
    if (u) {
      u.password = input.newPassword
      u.mustChangePassword = false
    }
    return undefined
  })
  if (!r.ok) return { state, trace: empty, ok: false, message: r.error.message }
  return logon(r.state, deviceId, { ...input, password: input.newPassword })
}

/** Fermeture de session. */
export function logoff(state: LabState, deviceId: string): LabState {
  const r = transact(state, (draft) => {
    const d = draft.devices[deviceId]
    if (d && (d.kind === 'server' || d.kind === 'client') && d.host.session) {
      logEvent(draft, deviceId, {
        level: 'information',
        source: 'Security-Auditing',
        eventId: 4634,
        log: 'Sécurité',
        message: `Fermeture de session : ${d.host.session.domain ?? d.name}\\${d.host.session.user}.`
      })
      d.host.session = null
    }
    return undefined
  })
  return r.ok ? r.state : state
}

/**
 * Inscription DNS dynamique d'un membre du domaine : enregistrement A (et PTR si la zone
 * inverse existe) sur le serveur DNS du domaine, à condition que le poste l'utilise comme DNS.
 */
export function registerHostDns(draft: Draft<LabState>, device: Draft<HostDevice>): boolean {
  if (!device.host.domain || !device.powered) return false
  const domain = draft.domains[device.host.domain]
  if (!domain) return false
  const ip = device.interfaces.map((i) => effectiveIpv4(i)?.address).find((a) => a && !isApipa(a))
  if (!ip) return false
  const clientDns = dnsServersOf(device)
  for (const dcId of domain.controllers) {
    const dc = draft.devices[dcId]
    if (!dc || dc.kind !== 'server' || !dc.services.dns) continue
    const dcIps = dc.interfaces.map((i) => effectiveIpv4(i)?.address).filter((a): a is string => !!a)
    const usesDc = dc.id === device.id || clientDns.some((s) => dcIps.includes(s))
    if (!usesDc) continue
    const zone = dc.services.dns.zones.find((z) => z.name === domain.name)
    if (!zone || zone.dynamicUpdate === 'None') continue
    const name = device.name.toLowerCase()
    zone.records = zone.records.filter((r) => !(r.name === name && r.type === 'A' && r.dynamic))
    if (!zone.records.some((r) => r.name === name && r.type === 'A'))
      zone.records.push({ name, type: 'A', data: ip, ttl: 1200, dynamic: true })
    const reverse = dc.services.dns.zones.find(
      (z) => z.reverse && ptrQueryName(ip).endsWith(`.${z.name}`) && z.dynamicUpdate !== 'None'
    )
    if (reverse) {
      const ptr = ptrQueryName(ip).slice(0, -(reverse.name.length + 1))
      reverse.records = reverse.records.filter((r) => !(r.name === ptr && r.type === 'PTR' && r.dynamic))
      reverse.records.push({
        name: ptr,
        type: 'PTR',
        data: `${name}.${domain.name}.`,
        ttl: 1200,
        dynamic: true
      })
    }
    return true
  }
  return false
}
