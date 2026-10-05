/**
 * Critères de validation des labs : chaque type déclare son schéma (zod) et son évaluateur,
 * qui lit l'état du lab sans le modifier. Les évaluateurs utilisent les mêmes fonctions que
 * les consoles et l'interface (ping, résolution DNS, accès effectif…).
 */
import { z } from 'zod'
import type { Device, Domain, HostDevice, LabState, ServerDevice } from '../model/schema'
import { effectiveIpv4 } from '../net/addressing'
import { isIpv4 } from '../net/ipv4'
import { ping } from '../net/diagnostics'
import { allObjects, findContainer, groupsOf } from '../services/adds/directory'
import { firstAddress, resolveName } from '../services/dns-resolver'
import { effectiveAccess, PERMS, principalToken, resolvePrincipal } from '../services/files/acl'
import { findNode, nodePath } from '../services/files/paths'
import { sessionDrives } from '../services/files/smb'
import { findGpo, linksAt } from '../services/gpo/scope'
import { settingValue, type SettingKey } from '../services/gpo/settings'

const PermSchema = z.enum(PERMS)

/** Types de vérifications disponibles. */
export const CheckSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('interfaceIp'),
    device: z.string(),
    /** Nom de la carte (Gi0/0, Ethernet0) ; par défaut la première carte de niveau 3. */
    interface: z.string().optional(),
    address: z.string(),
    prefixLength: z.number().int().optional(),
    gateway: z.string().optional()
  }),
  z.object({ type: z.literal('ping'), from: z.string(), to: z.string() }),
  z.object({ type: z.literal('featureInstalled'), device: z.string(), feature: z.string() }),
  z.object({
    type: z.literal('dhcpScope'),
    server: z.string(),
    start: z.string(),
    end: z.string(),
    prefixLength: z.number().int().optional(),
    router: z.string().optional(),
    dnsServer: z.string().optional()
  }),
  z.object({ type: z.literal('dhcpLease'), client: z.string(), server: z.string().optional() }),
  z.object({
    type: z.literal('dnsRecord'),
    server: z.string(),
    zone: z.string(),
    name: z.string(),
    recordType: z.enum(['A', 'PTR', 'CNAME', 'NS', 'SRV']),
    data: z.string().optional()
  }),
  z.object({ type: z.literal('nslookup'), client: z.string(), name: z.string(), address: z.string() }),
  z.object({
    type: z.literal('adObject'),
    kind: z.enum(['ou', 'user', 'group', 'computer']),
    name: z.string(),
    /** Nom de l'unité d'organisation parente. */
    parent: z.string().optional(),
    /** Groupe dont l'objet doit être membre (directement ou par imbrication). */
    memberOf: z.string().optional(),
    enabled: z.boolean().optional()
  }),
  z.object({ type: z.literal('domainJoined'), device: z.string(), domain: z.string() }),
  z.object({
    type: z.literal('gpoLinked'),
    gpo: z.string(),
    /** Nom de l'OU, ou nom DNS du domaine pour la racine. */
    target: z.string(),
    enforced: z.boolean().optional()
  }),
  z.object({ type: z.literal('gpoSetting'), gpo: z.string(), setting: z.string(), value: z.string() }),
  z.object({
    type: z.literal('gpoApplied'),
    device: z.string(),
    gpo: z.string(),
    part: z.enum(['computer', 'user']),
    account: z.string().optional()
  }),
  z.object({ type: z.literal('share'), server: z.string(), name: z.string(), path: z.string().optional() }),
  z.object({
    type: z.literal('effectiveAccess'),
    server: z.string(),
    path: z.string(),
    account: z.string(),
    /** Accès au travers de ce partage (partage ∩ NTFS). */
    share: z.string().optional(),
    allow: z.array(PermSchema).default([]),
    deny: z.array(PermSchema).default([])
  }),
  z.object({
    type: z.literal('driveMapped'),
    device: z.string(),
    letter: z.string(),
    path: z.string(),
    account: z.string().optional()
  })
])

export const CriterionSchema = z.object({
  id: z.string(),
  /** Ce qui est attendu, formulé pour l'étudiant. */
  label: z.string(),
  /** Indice affiché en cas d'échec : oriente sans donner la solution. */
  hint: z.string(),
  check: CheckSchema
})

export type Check = z.infer<typeof CheckSchema>
export type Criterion = z.infer<typeof CriterionSchema>

function byName(state: LabState, name: string): Device | undefined {
  const lower = name.toLowerCase()
  return Object.values(state.devices).find((d) => d.name.toLowerCase() === lower)
}

function hostByName(state: LabState, name: string): HostDevice | undefined {
  const d = byName(state, name)
  return d && (d.kind === 'server' || d.kind === 'client') ? d : undefined
}

function serverByName(state: LabState, name: string): ServerDevice | undefined {
  const d = byName(state, name)
  return d?.kind === 'server' ? d : undefined
}

/** Adresse IP d'une cible : adresse littérale ou première adresse d'un équipement. */
function targetIp(state: LabState, target: string): string | null {
  if (isIpv4(target)) return target
  const device = byName(state, target)
  for (const iface of device?.interfaces ?? []) {
    const eff = effectiveIpv4(iface)
    if (eff) return eff.address
  }
  return null
}

function firstDomain(state: LabState): Domain | undefined {
  return Object.values(state.domains)[0]
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const fqdn = (s: string) => s.toLowerCase().replace(/\.$/, '')

/** Évalue une vérification sur l'état du lab. */
export function evaluateCheck(state: LabState, check: Check): boolean {
  switch (check.type) {
    case 'interfaceIp': {
      const device = byName(state, check.device)
      const iface = check.interface
        ? device?.interfaces.find((i) => sameName(i.name, check.interface ?? ''))
        : device?.interfaces.find((i) => i.l3)
      const eff = iface ? effectiveIpv4(iface) : null
      return (
        !!eff &&
        eff.address === check.address &&
        (check.prefixLength === undefined || eff.prefixLength === check.prefixLength) &&
        (check.gateway === undefined || eff.gateway === check.gateway)
      )
    }
    case 'ping': {
      const from = byName(state, check.from)
      const ip = targetIp(state, check.to)
      if (!from || !ip) return false
      const r = ping(state, from.id, ip, { count: 1 })
      return r.ok && r.value.success
    }
    case 'featureInstalled':
      return !!hostByName(state, check.device)?.host.features.includes(check.feature)
    case 'dhcpScope': {
      const scopes = serverByName(state, check.server)?.services.dhcp?.scopes ?? []
      return scopes.some(
        (s) =>
          s.start === check.start &&
          s.end === check.end &&
          s.state === 'Active' &&
          (check.prefixLength === undefined || s.prefixLength === check.prefixLength) &&
          (check.router === undefined || s.options.router.includes(check.router)) &&
          (check.dnsServer === undefined || s.options.dnsServers.includes(check.dnsServer))
      )
    }
    case 'dhcpLease': {
      const client = hostByName(state, check.client)
      const server = check.server ? byName(state, check.server) : undefined
      return !!client?.interfaces.some(
        (i) =>
          i.addressing === 'dhcp' && !!i.dhcpLease && (!server || i.dhcpLease.serverDeviceId === server.id)
      )
    }
    case 'dnsRecord': {
      const zone = serverByName(state, check.server)?.services.dns?.zones.find(
        (z) => z.name === fqdn(check.zone)
      )
      return !!zone?.records.some(
        (r) =>
          r.type === check.recordType &&
          sameName(r.name, check.name) &&
          (check.data === undefined || fqdn(r.data) === fqdn(check.data))
      )
    }
    case 'nslookup': {
      const client = byName(state, check.client)
      return !!client && firstAddress(resolveName(state, client.id, check.name)) === check.address
    }
    case 'adObject': {
      const domain = firstDomain(state)
      if (!domain) return false
      const found = allObjects(domain).find((o) => {
        if (o.kind !== (check.kind === 'ou' ? 'container' : check.kind)) return false
        if (o.kind === 'container' && o.obj.kind !== 'ou') return false
        return (
          sameName(o.obj.name, check.name) ||
          (o.kind !== 'container' && o.kind !== 'computer' && sameName(o.obj.sam, check.name))
        )
      })
      if (!found) return false
      if (check.parent !== undefined) {
        const parent = findContainer(domain, found.obj.parentId)
        if (!parent || !sameName(parent.name, check.parent)) return false
      }
      if (
        check.memberOf !== undefined &&
        !groupsOf(domain, found.obj.id).some((g) => sameName(g.name, check.memberOf ?? ''))
      )
        return false
      if (check.enabled !== undefined && (found.kind === 'user' || found.kind === 'computer'))
        return found.obj.enabled === check.enabled
      return true
    }
    case 'domainJoined':
      return hostByName(state, check.device)?.host.domain === fqdn(check.domain)
    case 'gpoLinked': {
      const domain = firstDomain(state)
      const gpo = domain ? findGpo(domain, check.gpo) : undefined
      if (!domain || !gpo) return false
      const targetId =
        fqdn(check.target) === domain.name
          ? null
          : (domain.containers.find((c) => c.kind === 'ou' && sameName(c.name, check.target))?.id ??
            undefined)
      if (targetId === undefined) return false
      const link = linksAt(domain, targetId).find((l) => l.gpoId === gpo.id)
      return !!link && link.enabled && (check.enforced === undefined || link.enforced === check.enforced)
    }
    case 'gpoSetting': {
      const domain = firstDomain(state)
      const gpo = domain ? findGpo(domain, check.gpo) : undefined
      if (!gpo) return false
      const value = settingValue(check.setting as SettingKey, gpo.computer, gpo.user)
      return value !== null && value.toLowerCase().startsWith(check.value.toLowerCase())
    }
    case 'gpoApplied': {
      const host = hostByName(state, check.device)
      const result = host?.host.policy[check.part]
      if (!result || !result.applied.some((a) => sameName(a.name, check.gpo))) return false
      return (
        check.account === undefined ||
        (check.part === 'user' && sameName(host?.host.policy.user?.account ?? '', check.account))
      )
    }
    case 'share': {
      const server = serverByName(state, check.server)
      const share = server?.storage.shares.find((s) => sameName(s.name, check.name))
      return (
        !!server &&
        !!share &&
        (check.path === undefined || sameName(nodePath(server.storage, share.folderId), check.path))
      )
    }
    case 'effectiveAccess': {
      const server = serverByName(state, check.server)
      if (!server) return false
      const node = findNode(server.storage, check.path)
      if (node === undefined) return false
      const principal = resolvePrincipal(state, server, check.account)
      const token = principal ? principalToken(state, server, principal) : null
      if (!token) return false
      const share = check.share
        ? server.storage.shares.find((s) => sameName(s.name, check.share ?? ''))
        : undefined
      if (check.share && !share) return false
      const rights = effectiveAccess(server.storage, node?.id ?? null, token, share)
      const allowed = new Set(rights.filter((r) => r.allowed).map((r) => r.perm))
      return check.allow.every((p) => allowed.has(p)) && check.deny.every((p) => !allowed.has(p))
    }
    case 'driveMapped': {
      const host = hostByName(state, check.device)
      if (!host) return false
      const account =
        check.account ??
        (host.host.session ? `${host.host.session.domain ?? host.name}\\${host.host.session.user}` : null)
      return sessionDrives(host, account).some(
        (d) => d.letter === check.letter.replace(/:$/, '').toUpperCase() && sameName(d.path, check.path)
      )
    }
  }
}

export interface CriterionResult {
  id: string
  ok: boolean
}

/** Évalue tous les critères d'un lab. */
export function evaluateCriteria(state: LabState, criteria: Criterion[]): CriterionResult[] {
  return criteria.map((c) => ({ id: c.id, ok: evaluateCheck(state, c.check) }))
}
