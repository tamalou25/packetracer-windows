/**
 * Serveur DHCP : administration des étendues, exclusions, réservations et options.
 */
import type { Draft } from 'immer'
import { raise, transact, type EngineResult } from '../core/result'
import type { DhcpOptions, DhcpScope, DhcpServer, LabState, ServerDevice } from '../model/schema'
import { effectiveIpv4 } from '../net/addressing'
import { isInternetHost } from '../net/internet'
import { broadcastInt, formatIpv4, inNetwork, networkInt, parseIpv4, parseMaskOrPrefix } from '../net/ipv4'
import { requireDevice } from '../topology/actions'

export const DEFAULT_LEASE_SEC = 8 * 24 * 3600

export function createDhcpServer(): DhcpServer {
  return {
    authorized: false,
    configured: false,
    scopes: [],
    serverOptions: { router: [], dnsServers: [], dnsDomain: null }
  }
}

/** Normalise une adresse MAC au format XX-XX-XX-XX-XX-XX (null si invalide). */
export function normalizeMac(text: string): string | null {
  const hex = text.replace(/[^0-9a-fA-F]/g, '')
  if (hex.length !== 12 || /[^0-9a-fA-F:\-. ]/.test(text.trim())) return null
  return hex.toUpperCase().match(/.{2}/g)?.join('-') ?? null
}

/** Durée « j.hh:mm:ss » ou « hh:mm:ss » → secondes. */
export function parseLeaseDuration(text: string): number | null {
  const m = /^(?:(\d+)\.)?(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim())
  if (!m) return null
  const seconds = Number(m[1] ?? 0) * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4] ?? 0)
  return seconds > 0 ? seconds : null
}

export function formatLeaseDuration(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d}.${p(h)}:${p(m)}:${p(s)}`
}

/** Serveur DHCP d'un équipement (rôle installé), sinon erreur métier. */
export function requireDhcp(
  draft: Draft<LabState>,
  deviceId: string
): { device: Draft<ServerDevice>; dhcp: Draft<DhcpServer> } {
  const device = requireDevice(draft, deviceId)
  if (device.kind !== 'server' || !device.host.features.includes('DHCP'))
    raise('DhcpNotInstalled', 'Le rôle Serveur DHCP n’est pas installé sur cet ordinateur.')
  if (!device.services.dhcp) device.services.dhcp = createDhcpServer()
  return { device, dhcp: device.services.dhcp }
}

export function findScope<T extends Pick<DhcpScope, 'scopeId'>>(scopes: T[], scopeId: string): T {
  const scope = scopes.find((s) => s.scopeId === scopeId.trim())
  if (!scope) raise('ScopeNotFound', `L’étendue ${scopeId} n’existe pas sur ce serveur DHCP.`)
  return scope
}

function ipInt(text: string, label: string): number {
  const v = parseIpv4(text.trim())
  if (v === null) raise('InvalidAddress', `${label} « ${text} » n’est pas une adresse IPv4 valide.`)
  return v
}

/** Vrai si l'adresse est dans la plage de l'étendue. */
export function inScopeRange(scope: Pick<DhcpScope, 'start' | 'end'>, ip: string): boolean {
  const v = parseIpv4(ip)
  const a = parseIpv4(scope.start)
  const b = parseIpv4(scope.end)
  return v !== null && a !== null && b !== null && v >= a && v <= b
}

export function isExcluded(scope: Pick<DhcpScope, 'exclusions'>, ip: string): boolean {
  const v = parseIpv4(ip)
  if (v === null) return false
  return scope.exclusions.some((ex) => {
    const a = parseIpv4(ex.start)
    const b = parseIpv4(ex.end)
    return a !== null && b !== null && v >= a && v <= b
  })
}

export interface ScopeInput {
  name: string
  start: string
  end: string
  mask: string
  description?: string
  state?: 'Active' | 'Inactive'
  leaseDuration?: string
}

/** Crée une étendue (Add-DhcpServerv4Scope / assistant Nouvelle étendue). Renvoie son identifiant. */
export function addScope(state: LabState, deviceId: string, input: ScopeInput): EngineResult<string> {
  return transact(state, (draft) => {
    const { dhcp } = requireDhcp(draft, deviceId)
    const name = input.name.trim()
    if (!name) raise('InvalidName', 'Entrez un nom pour l’étendue.')
    const start = ipInt(input.start, 'L’adresse IP de début')
    const end = ipInt(input.end, 'L’adresse IP de fin')
    const prefix = parseMaskOrPrefix(input.mask)
    if (prefix === null || prefix < 1 || prefix > 30)
      raise('InvalidMask', `Le masque de sous-réseau « ${input.mask} » n’est pas valide.`)
    if (networkInt(start, prefix) !== networkInt(end, prefix))
      raise('InvalidRange', 'Les adresses de début et de fin doivent appartenir au même sous-réseau.')
    if (start > end)
      raise('InvalidRange', 'L’adresse de début doit être inférieure ou égale à l’adresse de fin.')
    if (start === networkInt(start, prefix))
      raise('InvalidRange', 'L’adresse de début ne peut pas être l’adresse du réseau.')
    if (end === broadcastInt(end, prefix))
      raise('InvalidRange', 'L’adresse de fin ne peut pas être l’adresse de diffusion.')
    const scopeId = formatIpv4(networkInt(start, prefix))
    if (dhcp.scopes.some((s) => s.scopeId === scopeId))
      raise('ScopeExists', `L’étendue ${scopeId} existe déjà.`)
    let leaseDurationSec = DEFAULT_LEASE_SEC
    if (input.leaseDuration) {
      const parsed = parseLeaseDuration(input.leaseDuration)
      if (parsed === null)
        raise(
          'InvalidDuration',
          `La durée de bail « ${input.leaseDuration} » n’est pas valide (format j.hh:mm:ss).`
        )
      leaseDurationSec = parsed
    }
    dhcp.scopes.push({
      scopeId,
      name,
      description: input.description ?? '',
      start: formatIpv4(start),
      end: formatIpv4(end),
      prefixLength: prefix,
      state: input.state ?? 'Active',
      leaseDurationSec,
      exclusions: [],
      reservations: [],
      leases: [],
      options: { router: [], dnsServers: [], dnsDomain: null }
    })
    return scopeId
  })
}

export function removeScope(state: LabState, deviceId: string, scopeId: string): EngineResult {
  return transact(state, (draft) => {
    const { dhcp } = requireDhcp(draft, deviceId)
    findScope(dhcp.scopes, scopeId)
    dhcp.scopes = dhcp.scopes.filter((s) => s.scopeId !== scopeId.trim())
    return undefined
  })
}

export function setScopeState(
  state: LabState,
  deviceId: string,
  scopeId: string,
  active: boolean
): EngineResult {
  return transact(state, (draft) => {
    const { dhcp } = requireDhcp(draft, deviceId)
    findScope(dhcp.scopes, scopeId).state = active ? 'Active' : 'Inactive'
    return undefined
  })
}

export function addExclusion(
  state: LabState,
  deviceId: string,
  scopeId: string,
  startIp: string,
  endIp: string
): EngineResult {
  return transact(state, (draft) => {
    const { dhcp } = requireDhcp(draft, deviceId)
    const scope = findScope(dhcp.scopes, scopeId)
    const a = ipInt(startIp, 'L’adresse de début')
    const b = ipInt(endIp || startIp, 'L’adresse de fin')
    if (a > b) raise('InvalidRange', 'L’adresse de début doit être inférieure ou égale à l’adresse de fin.')
    if (!inScopeRange(scope, formatIpv4(a)) || !inScopeRange(scope, formatIpv4(b)))
      raise(
        'OutOfScope',
        `La plage d’exclusion doit être comprise dans la plage de l’étendue (${scope.start} - ${scope.end}).`
      )
    if (scope.exclusions.some((ex) => ex.start === formatIpv4(a) && ex.end === formatIpv4(b)))
      raise('Duplicate', 'Cette plage d’exclusion existe déjà.')
    scope.exclusions.push({ start: formatIpv4(a), end: formatIpv4(b) })
    // Les baux actifs dans la plage exclue restent valides jusqu'à expiration (comme en réel)
    return undefined
  })
}

export function removeExclusion(
  state: LabState,
  deviceId: string,
  scopeId: string,
  index: number
): EngineResult {
  return transact(state, (draft) => {
    const { dhcp } = requireDhcp(draft, deviceId)
    const scope = findScope(dhcp.scopes, scopeId)
    if (index < 0 || index >= scope.exclusions.length) raise('NotFound', 'Plage d’exclusion introuvable.')
    scope.exclusions.splice(index, 1)
    return undefined
  })
}

export interface ReservationInput {
  ip: string
  mac: string
  name: string
  description?: string
}

export function addReservation(
  state: LabState,
  deviceId: string,
  scopeId: string,
  input: ReservationInput
): EngineResult {
  return transact(state, (draft) => {
    const { dhcp } = requireDhcp(draft, deviceId)
    const scope = findScope(dhcp.scopes, scopeId)
    const ip = formatIpv4(ipInt(input.ip, 'L’adresse IP réservée'))
    if (!inScopeRange(scope, ip))
      raise(
        'OutOfScope',
        `L’adresse ${ip} n’est pas comprise dans la plage de l’étendue (${scope.start} - ${scope.end}).`
      )
    const mac = normalizeMac(input.mac)
    if (!mac)
      raise('InvalidMac', `L’adresse MAC « ${input.mac} » n’est pas valide (12 chiffres hexadécimaux).`)
    if (scope.reservations.some((r) => r.ip === ip)) raise('Duplicate', `L’adresse ${ip} est déjà réservée.`)
    if (scope.reservations.some((r) => r.mac === mac))
      raise('Duplicate', `Une réservation existe déjà pour l’adresse MAC ${mac}.`)
    scope.reservations.push({ ip, mac, name: input.name.trim() || ip, description: input.description ?? '' })
    return undefined
  })
}

export function removeReservation(
  state: LabState,
  deviceId: string,
  scopeId: string,
  ipOrMac: string
): EngineResult {
  return transact(state, (draft) => {
    const { dhcp } = requireDhcp(draft, deviceId)
    const scope = findScope(dhcp.scopes, scopeId)
    const mac = normalizeMac(ipOrMac)
    const before = scope.reservations.length
    scope.reservations = scope.reservations.filter((r) => r.ip !== ipOrMac.trim() && r.mac !== mac)
    if (scope.reservations.length === before) raise('NotFound', 'Réservation introuvable.')
    return undefined
  })
}

/** Vrai si l'adresse désigne un serveur DNS joignable dans le lab (rôle DNS) ou un résolveur public. */
export function isKnownDnsServer(state: LabState, ip: string): boolean {
  if (isInternetHost(ip)) return true
  return Object.values(state.devices).some(
    (d) =>
      d.kind === 'server' &&
      d.host.features.includes('DNS') &&
      d.interfaces.some((i) => effectiveIpv4(i)?.address === ip)
  )
}

export interface OptionsInput {
  router?: string[]
  dnsServers?: string[]
  dnsDomain?: string | null
  /** Ne pas vérifier que les serveurs DNS répondent (-Force). */
  force?: boolean
}

/** Définit les options 003/006/015 d'une étendue (scopeId) ou du serveur (null). */
export function setDhcpOptions(
  state: LabState,
  deviceId: string,
  scopeId: string | null,
  input: OptionsInput
): EngineResult {
  return transact(state, (draft) => {
    const { dhcp } = requireDhcp(draft, deviceId)
    const target: Draft<DhcpOptions> = scopeId ? findScope(dhcp.scopes, scopeId).options : dhcp.serverOptions
    if (input.router) {
      const routers = input.router.map((r) => r.trim()).filter((r) => r)
      for (const r of routers) ipInt(r, 'Le routeur')
      if (scopeId) {
        const scope = findScope(dhcp.scopes, scopeId)
        for (const r of routers)
          if (!inNetwork(r, scope.scopeId, scope.prefixLength))
            raise(
              'InvalidRouter',
              `Le routeur ${r} n’appartient pas au réseau de l’étendue ${scope.scopeId}/${scope.prefixLength}.`
            )
      }
      target.router = routers
    }
    if (input.dnsServers) {
      const servers = input.dnsServers.map((r) => r.trim()).filter((r) => r)
      for (const s of servers) {
        ipInt(s, 'Le serveur DNS')
        if (!input.force && !isKnownDnsServer(draft as LabState, s))
          raise(
            'InvalidDnsServer',
            `Le serveur DNS ${s} n’est pas un serveur DNS valide (aucun serveur DNS ne répond à cette adresse). Utilisez -Force pour l’enregistrer quand même.`
          )
      }
      target.dnsServers = servers
    }
    if (input.dnsDomain !== undefined) target.dnsDomain = input.dnsDomain?.trim() || null
    return undefined
  })
}

/** Options effectives d'une étendue (options d'étendue prioritaires sur celles du serveur). */
export function effectiveOptions(server: DhcpServer, scope: DhcpScope): DhcpOptions {
  return {
    router: scope.options.router.length > 0 ? scope.options.router : server.serverOptions.router,
    dnsServers:
      scope.options.dnsServers.length > 0 ? scope.options.dnsServers : server.serverOptions.dnsServers,
    dnsDomain: scope.options.dnsDomain ?? server.serverOptions.dnsDomain
  }
}

/** Interface d'écoute du serveur pour une étendue (adresse statique dans le réseau de l'étendue). */
export function scopeBinding(device: ServerDevice, scope: DhcpScope): string | null {
  for (const iface of device.interfaces) {
    const eff = effectiveIpv4(iface)
    if (eff && eff.source === 'static' && inNetwork(eff.address, scope.scopeId, scope.prefixLength))
      return iface.id
  }
  return null
}
