/**
 * Sites et services Active Directory : sites, sous-réseaux, liens de sites (coût, intervalle),
 * site de chaque contrôleur et enregistrements DNS propres au site (localisation d'un DC
 * proche par les clients).
 */
import type { Draft } from 'immer'
import { raise, transact, type EngineResult } from '../../core/result'
import type { AdSiteLink, Domain, LabState } from '../../model/schema'
import { DEFAULT_AD_SITE } from '../../model/schema'
import { effectiveIpv4 } from '../../net/addressing'
import { inNetwork, isIpv4, networkAddress } from '../../net/ipv4'
import type { DnsRecord, DnsZone } from '../dns/schema'
import { dnsServerOf } from '../dns/state'
import { requireDomain } from './objects'

/** Intervalle de réplication d'un lien de sites : 15 minutes à une semaine, par pas de 15 minutes. */
export const MIN_INTERVAL = 15
export const MAX_INTERVAL = 10080
export const MAX_COST = 99999

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Site d'un contrôleur de domaine. */
export function dcSite(domain: Domain, dcId: string): string {
  return domain.dcSites[dcId] ?? domain.sites[0]?.name ?? DEFAULT_AD_SITE
}

/** Contrôleurs d'un site. */
export function siteControllers(domain: Domain, site: string): string[] {
  return domain.controllers.filter((id) => same(dcSite(domain, id), site))
}

/** Sous-réseau CIDR valide (adresse de réseau alignée sur le préfixe). */
export function parseSubnet(prefix: string): { network: string; bits: number } | null {
  const [address = '', bitsText = ''] = prefix.trim().split('/')
  const bits = Number(bitsText)
  if (!isIpv4(address) || !/^\d+$/.test(bitsText) || bits < 1 || bits > 32) return null
  if (networkAddress(address, bits) !== address) return null
  return { network: address, bits }
}

/** Site d'une adresse IP : sous-réseau le plus spécifique qui la contient (null : aucun). */
export function siteOfAddress(domain: Domain, ip: string): string | null {
  let best: { site: string; bits: number } | null = null
  for (const subnet of domain.subnets) {
    const parsed = parseSubnet(subnet.prefix)
    if (parsed && inNetwork(ip, parsed.network, parsed.bits) && (!best || parsed.bits > best.bits))
      best = { site: subnet.site, bits: parsed.bits }
  }
  return best?.site ?? null
}

/** Enregistrements SRV publiés par un contrôleur (génériques et propres à son site). */
export function dcSrvRecords(dcName: string, domainName: string, site: string): DnsRecord[] {
  const fqdn = `${dcName.toLowerCase()}.${domainName}.`
  const srv = (name: string, port: number): DnsRecord => ({
    name,
    type: 'SRV',
    data: `0 100 ${port} ${fqdn}`,
    ttl: 600,
    dynamic: true
  })
  return [
    srv('_ldap._tcp', 389),
    srv('_kerberos._tcp', 88),
    srv('_ldap._tcp.dc._msdcs', 389),
    srv('_kerberos._tcp.dc._msdcs', 88),
    srv('_gc._tcp', 3268),
    srv(`_ldap._tcp.${site}._sites`, 389),
    srv(`_kerberos._tcp.${site}._sites`, 88),
    srv(`_ldap._tcp.${site}._sites.dc._msdcs`, 389),
    srv(`_kerberos._tcp.${site}._sites.dc._msdcs`, 88),
    srv(`_gc._tcp.${site}._sites`, 3268)
  ]
}

/** Enregistrements A et SRV d'un contrôleur de domaine. */
export function dcRecords(dcName: string, domainName: string, ip: string, site: string): DnsRecord[] {
  return [
    { name: '@', type: 'A', data: ip, ttl: 600, dynamic: true },
    { name: dcName.toLowerCase(), type: 'A', data: ip, ttl: 3600, dynamic: true },
    ...dcSrvRecords(dcName, domainName, site)
  ]
}

/** Zones DNS intégrées à AD du domaine, sur chaque contrôleur qui héberge le serveur DNS. */
export function domainZones(
  draft: Draft<LabState>,
  domain: Domain
): { dcId: string; zone: Draft<DnsZone> }[] {
  return domain.controllers.flatMap((dcId) => {
    const dns = dnsServerOf(draft.devices[dcId])
    const zone = dns?.zones.find((z) => z.name === domain.name && z.adIntegrated)
    return zone ? [{ dcId, zone: zone as Draft<DnsZone> }] : []
  })
}

/** Réinscrit les enregistrements SRV propres au site d'un contrôleur (Netlogon). */
export function refreshDcSiteRecords(draft: Draft<LabState>, domain: Draft<Domain>, dcId: string): void {
  const dc = draft.devices[dcId]
  if (!dc) return
  const target = `${dc.name.toLowerCase()}.${domain.name}.`
  const site = dcSite(domain, dcId)
  for (const { zone } of domainZones(draft, domain)) {
    zone.records = zone.records.filter(
      (r) => !(r.type === 'SRV' && r.name.includes('._sites') && r.data.endsWith(` ${target}`))
    )
    for (const r of dcSrvRecords(dc.name, domain.name, site))
      if (r.name.includes('._sites')) zone.records.push(r)
  }
}

/** Adresse IPv4 d'un équipement (première carte adressée). */
export function addressOf(state: LabState, deviceId: string): string | null {
  return state.devices[deviceId]?.interfaces.map((i) => effectiveIpv4(i)?.address).find((a) => !!a) ?? null
}

function validSiteName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(name)
}

function requireSite(domain: Draft<Domain>, name: string) {
  const site = domain.sites.find((s) => same(s.name, name))
  if (!site) raise('SiteNotFound', `Le site « ${name} » est introuvable.`)
  return site
}

/** Nouveau site (New-ADReplicationSite). */
export function newSite(
  state: LabState,
  domainName: string,
  input: { name: string; description?: string }
): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const name = input.name.trim()
    if (!validSiteName(name))
      raise(
        'InvalidSiteName',
        `Le nom de site « ${name} » n’est pas valide : lettres, chiffres et tirets uniquement (pas d’espace ni de point).`
      )
    if (domain.sites.some((s) => same(s.name, name))) raise('SiteExists', `Le site « ${name} » existe déjà.`)
    domain.sites.push({ name, description: input.description?.trim() ?? '' })
    return undefined
  })
}

/** Renomme un site (sous-réseaux, liens et contrôleurs suivent ; SRV réinscrits). */
export function renameSite(state: LabState, domainName: string, name: string, newName: string): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const site = requireSite(domain, name)
    const next = newName.trim()
    if (!validSiteName(next))
      raise(
        'InvalidSiteName',
        `Le nom de site « ${next} » n’est pas valide : lettres, chiffres et tirets uniquement.`
      )
    if (!same(next, site.name) && domain.sites.some((s) => same(s.name, next)))
      raise('SiteExists', `Le site « ${next} » existe déjà.`)
    const old = site.name
    site.name = next
    for (const subnet of domain.subnets) if (same(subnet.site, old)) subnet.site = next
    for (const link of domain.siteLinks) link.sites = link.sites.map((s) => (same(s, old) ? next : s))
    for (const dcId of domain.controllers) {
      if (!same(dcSite(domain, dcId), old)) continue
      domain.dcSites[dcId] = next
      refreshDcSiteRecords(draft, domain, dcId)
    }
    return undefined
  })
}

/** Supprime un site sans contrôleur (ses sous-réseaux et ses références dans les liens aussi). */
export function removeAdSite(state: LabState, domainName: string, name: string): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const site = requireSite(domain, name)
    if (siteControllers(domain, site.name).length > 0)
      raise(
        'SiteHasServers',
        `Le site « ${site.name} » contient des contrôleurs de domaine : déplacez-les d’abord.`
      )
    if (domain.sites.length === 1) raise('LastSite', 'Le dernier site de la forêt ne peut pas être supprimé.')
    domain.sites = domain.sites.filter((s) => s !== site)
    domain.subnets = domain.subnets.filter((s) => !same(s.site, site.name))
    for (const link of domain.siteLinks) link.sites = link.sites.filter((s) => !same(s, site.name))
    return undefined
  })
}

/** Nouveau sous-réseau associé à un site (New-ADReplicationSubnet). */
export function newSubnet(
  state: LabState,
  domainName: string,
  input: { prefix: string; site: string; description?: string }
): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const prefix = input.prefix.trim()
    if (!parseSubnet(prefix))
      raise(
        'InvalidSubnet',
        `Le préfixe « ${prefix} » n’est pas valide : indiquez l’adresse du réseau et la longueur du préfixe (192.168.20.0/24).`
      )
    const site = requireSite(domain, input.site)
    if (domain.subnets.some((s) => s.prefix === prefix))
      raise('SubnetExists', `Le sous-réseau ${prefix} existe déjà.`)
    domain.subnets.push({ prefix, site: site.name, description: input.description?.trim() ?? '' })
    return undefined
  })
}

/** Supprime un sous-réseau. */
export function removeSubnet(state: LabState, domainName: string, prefix: string): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const index = domain.subnets.findIndex((s) => s.prefix === prefix.trim())
    if (index < 0) raise('SubnetNotFound', `Le sous-réseau ${prefix} est introuvable.`)
    domain.subnets.splice(index, 1)
    return undefined
  })
}

function checkLinkValues(cost: number | undefined, interval: number | undefined): void {
  if (cost !== undefined && (!Number.isInteger(cost) || cost < 1 || cost > MAX_COST))
    raise('InvalidCost', `Le coût doit être un entier compris entre 1 et ${MAX_COST}.`)
  if (
    interval !== undefined &&
    (!Number.isInteger(interval) || interval < MIN_INTERVAL || interval > MAX_INTERVAL || interval % 15 !== 0)
  )
    raise(
      'InvalidInterval',
      `L’intervalle de réplication doit être un multiple de 15 minutes compris entre ${MIN_INTERVAL} et ${MAX_INTERVAL}.`
    )
}

export interface SiteLinkInput {
  name: string
  sites: string[]
  cost?: number
  interval?: number
}

/** Nouveau lien de sites IP (New-ADReplicationSiteLink) : au moins deux sites. */
export function newSiteLink(state: LabState, domainName: string, input: SiteLinkInput): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const name = input.name.trim()
    if (!name) raise('InvalidName', 'Indiquez le nom du lien de sites.')
    if (domain.siteLinks.some((l) => same(l.name, name)))
      raise('SiteLinkExists', `Le lien de sites « ${name} » existe déjà.`)
    const sites = [...new Set(input.sites.map((s) => requireSite(domain, s).name))]
    if (sites.length < 2) raise('TwoSitesRequired', 'Un lien de sites doit contenir au moins deux sites.')
    checkLinkValues(input.cost, input.interval)
    domain.siteLinks.push({ name, sites, cost: input.cost ?? 100, interval: input.interval ?? 180 })
    return undefined
  })
}

/** Modifie un lien de sites (Set-ADReplicationSiteLink) : coût, intervalle, sites. */
export function setSiteLink(
  state: LabState,
  domainName: string,
  name: string,
  input: { cost?: number; interval?: number; sites?: string[] }
): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const link = domain.siteLinks.find((l) => same(l.name, name)) as Draft<AdSiteLink> | undefined
    if (!link) raise('SiteLinkNotFound', `Le lien de sites « ${name} » est introuvable.`)
    checkLinkValues(input.cost, input.interval)
    if (input.sites) {
      const sites = [...new Set(input.sites.map((s) => requireSite(domain, s).name))]
      if (sites.length < 1) raise('TwoSitesRequired', 'Un lien de sites doit contenir au moins un site.')
      link.sites = sites
    }
    if (input.cost !== undefined) link.cost = input.cost
    if (input.interval !== undefined) link.interval = input.interval
    return undefined
  })
}

/** Supprime un lien de sites. */
export function removeSiteLink(state: LabState, domainName: string, name: string): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const index = domain.siteLinks.findIndex((l) => same(l.name, name))
    if (index < 0) raise('SiteLinkNotFound', `Le lien de sites « ${name} » est introuvable.`)
    domain.siteLinks.splice(index, 1)
    return undefined
  })
}

/** Déplace un contrôleur dans un autre site (Move-ADDirectoryServer). */
export function moveDcToSite(state: LabState, domainName: string, dcId: string, site: string): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    if (!domain.controllers.includes(dcId))
      raise('NotDomainController', 'Cet ordinateur n’est pas contrôleur du domaine.')
    domain.dcSites[dcId] = requireSite(domain, site).name
    refreshDcSiteRecords(draft, domain, dcId)
    return undefined
  })
}
