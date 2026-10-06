/**
 * Serveur DNS : zones primaires (directes/inverses), enregistrements, redirecteurs.
 */
import type { Draft } from 'immer'
import { raise, transact, type EngineResult } from '../../core/result'
import type { LabState, ServerDevice } from '../../model/schema'
import { isIpv4, parseIpv4 } from '../../net/ipv4'
import { requireDevice } from '../../topology/actions'
import { ensureRoleState } from '../state'
import type { DnsRecordType, DnsServer, DnsZone } from './schema'
import { DNS_STATE } from './state'

/** Normalise un nom DNS (minuscules, sans point final). */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\.$/, '')
}

/** Nom pleinement qualifié d'un serveur (srv1.lab.local ou srv1). */
export function serverFqdn(device: { name: string; host: { domain: string | null } }): string {
  return device.host.domain ? `${device.name.toLowerCase()}.${device.host.domain}` : device.name.toLowerCase()
}

export function validDnsName(name: string): boolean {
  const n = normalizeName(name)
  return (
    n.length > 0 &&
    n.length <= 253 &&
    n.split('.').every((l) => /^[a-z0-9_]([a-z0-9-_]{0,61}[a-z0-9_])?$/.test(l))
  )
}

/** Zone inverse correspondant à un réseau (frontières d'octet : /8, /16, /24). */
export function reverseZoneFor(networkId: string): string | null {
  const [ip, prefixText] = networkId.trim().split('/')
  const prefix = Number(prefixText ?? 24)
  if (!ip || !isIpv4(ip) || ![8, 16, 24].includes(prefix)) return null
  const octets = ip.split('.').slice(0, prefix / 8)
  return `${octets.reverse().join('.')}.in-addr.arpa`
}

/** Nom complet PTR d'une adresse (10.1.168.192.in-addr.arpa). */
export function ptrQueryName(ip: string): string {
  return `${ip.split('.').reverse().join('.')}.in-addr.arpa`
}

/** Plus longue zone dont le nom est un suffixe du nom recherché. */
export function findZoneFor(dns: DnsServer, fqdn: string): DnsZone | null {
  const name = normalizeName(fqdn)
  let best: DnsZone | null = null
  for (const z of dns.zones) {
    if (name === z.name || name.endsWith(`.${z.name}`))
      if (!best || z.name.length > best.name.length) best = z
  }
  return best
}

/** Nom relatif à la zone (« @ » pour la racine). */
export function relativeName(zone: DnsZone, fqdn: string): string {
  const name = normalizeName(fqdn)
  return name === zone.name ? '@' : name.slice(0, name.length - zone.name.length - 1)
}

export function requireDns(
  draft: Draft<LabState>,
  deviceId: string
): { device: Draft<ServerDevice>; dns: Draft<DnsServer> } {
  const device = requireDevice(draft, deviceId)
  if (device.kind !== 'server' || !device.host.features.includes('DNS'))
    raise('DnsNotInstalled', 'Le rôle Serveur DNS n’est pas installé sur cet ordinateur.')
  return { device, dns: ensureRoleState(device, DNS_STATE) }
}

function requireZone(dns: Draft<DnsServer>, zoneName: string): Draft<DnsZone> {
  const zone = dns.zones.find((z) => z.name === normalizeName(zoneName))
  if (!zone) raise('ZoneNotFound', `La zone ${zoneName} est introuvable sur le serveur DNS.`)
  return zone
}

export interface ZoneInput {
  /** Nom de la zone directe (lab.local). */
  name?: string
  /** Réseau d'une zone inverse (192.168.1.0/24). */
  networkId?: string
  adIntegrated?: boolean
  dynamicUpdate?: 'None' | 'Secure' | 'NonsecureAndSecure'
}

/** Vrai si l'ordinateur est contrôleur de domaine (stockage AD des zones). */
export function isDomainController(state: LabState | Draft<LabState>, deviceId: string): boolean {
  return Object.values(state.domains).some((d) => d.controllers.includes(deviceId))
}

/** Crée une zone principale. Renvoie son nom. */
export function addPrimaryZone(state: LabState, deviceId: string, input: ZoneInput): EngineResult<string> {
  return transact(state, (draft) => {
    const { device, dns } = requireDns(draft, deviceId)
    let name: string
    let reverse: boolean
    if (input.networkId) {
      const z = reverseZoneFor(input.networkId)
      if (!z)
        raise(
          'InvalidNetworkId',
          `L’identificateur réseau « ${input.networkId} » n’est pas valide (exemple : 192.168.1.0/24).`
        )
      name = z
      reverse = true
    } else {
      if (!input.name || !validDnsName(input.name))
        raise('InvalidZoneName', `Le nom de zone « ${input.name ?? ''} » n’est pas valide.`)
      name = normalizeName(input.name)
      reverse = name.endsWith('.in-addr.arpa')
    }
    if (dns.zones.some((z) => z.name === name)) raise('ZoneExists', `La zone ${name} existe déjà.`)
    if (input.adIntegrated && !isDomainController(draft, deviceId))
      raise(
        'NotDomainController',
        'Une zone intégrée à Active Directory ne peut être créée que sur un contrôleur de domaine.'
      )
    if (input.dynamicUpdate === 'Secure' && !input.adIntegrated)
      raise(
        'SecureRequiresAd',
        'Les mises à jour dynamiques sécurisées ne sont disponibles que pour les zones intégrées à Active Directory.'
      )
    const fqdn = serverFqdn(device)
    dns.zones.push({
      name,
      reverse,
      adIntegrated: !!input.adIntegrated,
      dynamicUpdate: input.dynamicUpdate ?? (input.adIntegrated ? 'Secure' : 'None'),
      records: [
        {
          name: '@',
          type: 'SOA',
          data: `${fqdn}. hostmaster.${reverse ? fqdn : name}. 1 900 600 86400 3600`,
          ttl: 3600,
          dynamic: false
        },
        { name: '@', type: 'NS', data: `${fqdn}.`, ttl: 3600, dynamic: false }
      ]
    })
    return name
  })
}

export function removeZone(state: LabState, deviceId: string, zoneName: string): EngineResult {
  return transact(state, (draft) => {
    const { dns } = requireDns(draft, deviceId)
    requireZone(dns, zoneName)
    dns.zones = dns.zones.filter((z) => z.name !== normalizeName(zoneName))
    return undefined
  })
}

export interface RecordInput {
  name: string
  type: DnsRecordType
  data: string
  ttl?: number
  /** Pour un enregistrement A : créer le PTR associé. */
  createPtr?: boolean
  dynamic?: boolean
}

/** Ajoute un enregistrement dans une zone. Renvoie d'éventuels avertissements. */
export function addRecord(
  state: LabState,
  deviceId: string,
  zoneName: string,
  input: RecordInput
): EngineResult<{ warnings: string[] }> {
  return transact(state, (draft) => {
    const { dns } = requireDns(draft, deviceId)
    const zone = requireZone(dns, zoneName)
    const warnings: string[] = []
    let name = input.name.trim() === '' ? '@' : input.name.trim().toLowerCase()
    // Nom complet saisi : on le ramène au nom relatif
    if (name !== '@' && (name === zone.name || name.endsWith(`.${zone.name}`)))
      name = relativeName(zone, name)
    if (name !== '@' && !validDnsName(name))
      raise('InvalidName', `Le nom « ${input.name} » n’est pas un nom DNS valide.`)
    let data = input.data.trim()
    switch (input.type) {
      case 'A':
        if (!isIpv4(data)) raise('InvalidData', `« ${data} » n’est pas une adresse IPv4 valide.`)
        break
      case 'CNAME':
      case 'PTR':
      case 'NS':
        if (!validDnsName(data))
          raise('InvalidData', `« ${data} » n’est pas un nom de domaine complet valide.`)
        data = `${normalizeName(data)}.`
        break
      default:
        break
    }
    const same = zone.records.filter((r) => r.name === name)
    if (same.some((r) => r.type === input.type && r.data.toLowerCase() === data.toLowerCase()))
      raise('RecordExists', 'Un enregistrement identique existe déjà.')
    if (input.type === 'CNAME' && same.length > 0)
      raise(
        'CnameConflict',
        `Le nom « ${name} » est déjà utilisé : un alias (CNAME) ne peut pas coexister avec un autre enregistrement du même nom.`
      )
    if (input.type !== 'CNAME' && same.some((r) => r.type === 'CNAME'))
      raise(
        'CnameConflict',
        `Le nom « ${name} » est un alias (CNAME) : aucun autre enregistrement ne peut porter ce nom.`
      )
    zone.records.push({ name, type: input.type, data, ttl: input.ttl ?? 3600, dynamic: !!input.dynamic })

    if (input.type === 'A' && input.createPtr) {
      const fqdn = name === '@' ? zone.name : `${name}.${zone.name}`
      const reverse = dns.zones
        .filter((z) => z.reverse && ptrQueryName(data).endsWith(`.${z.name}`))
        .sort((a, b) => b.name.length - a.name.length)[0]
      if (!reverse) {
        warnings.push(
          'L’enregistrement de pointeur (PTR) associé n’a pas pu être créé, probablement parce que la zone de recherche inversée référencée est introuvable.'
        )
      } else {
        const ptrName = relativeName(reverse, ptrQueryName(data))
        if (!reverse.records.some((r) => r.name === ptrName && r.type === 'PTR' && r.data === `${fqdn}.`))
          reverse.records.push({
            name: ptrName,
            type: 'PTR',
            data: `${fqdn}.`,
            ttl: input.ttl ?? 3600,
            dynamic: !!input.dynamic
          })
      }
    }
    return { warnings }
  })
}

export function removeRecord(
  state: LabState,
  deviceId: string,
  zoneName: string,
  name: string,
  type: DnsRecordType,
  data?: string
): EngineResult {
  return transact(state, (draft) => {
    const { dns } = requireDns(draft, deviceId)
    const zone = requireZone(dns, zoneName)
    const rel = name.trim() === '' ? '@' : name.trim().toLowerCase()
    const before = zone.records.length
    zone.records = zone.records.filter(
      (r) =>
        !(
          r.name === rel &&
          r.type === type &&
          (data === undefined || r.data.replace(/\.$/, '') === data.replace(/\.$/, '').toLowerCase())
        )
    )
    if (zone.records.length === before)
      raise('RecordNotFound', `Aucun enregistrement ${type} nommé « ${name} » dans la zone ${zone.name}.`)
    return undefined
  })
}

/** Remplace la liste des redirecteurs. */
export function setForwarders(state: LabState, deviceId: string, forwarders: string[]): EngineResult {
  return transact(state, (draft) => {
    const { dns } = requireDns(draft, deviceId)
    const list = forwarders.map((f) => f.trim()).filter((f) => f)
    for (const f of list)
      if (parseIpv4(f) === null) raise('InvalidAddress', `« ${f} » n’est pas une adresse IPv4 valide.`)
    dns.forwarders = [...new Set(list)]
    return undefined
  })
}
