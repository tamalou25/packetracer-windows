/**
 * Labs pédagogiques : format JSON (énoncé, topologie de départ, critères) et construction de
 * l'état de départ avec les actions du moteur (déterministe : même lab = même état).
 */
import { z } from 'zod'
import { unwrap } from '../core/result'
import { createLab } from '../model/factory'
import { DEVICE_KINDS } from '../model/kinds'
import type { LabState } from '../model/schema'
import { setInterfaceIpv4 } from '../net/config'
import { addGroup, addGroupMembers, addOrganizationalUnit, addUser } from '../services/adds/objects'
import { installForest } from '../services/adds/forest'
import { joinDomain } from '../services/adds/join'
import { installFeatures } from '../services/features'
import { restartComputer } from '../services/system'
import { addDevice, connect } from '../topology/actions'
import { CriterionSchema, evaluateCriteria, type CriterionResult } from './criteria'

export const LAB_FORMAT_VERSION = 1

export const LabDeviceSchema = z.object({
  kind: z.enum(DEVICE_KINDS),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  powered: z.boolean().default(true),
  /** Adresse statique de la première carte (CIDR : 192.168.10.1/24). */
  ip: z.string().optional(),
  gateway: z.string().optional(),
  dns: z.array(z.string()).optional(),
  /** Première carte en DHCP (postes). */
  dhcp: z.boolean().optional(),
  /** Interfaces d'un routeur : { "Gi0/0": "192.168.10.254/24" }. */
  interfaces: z.record(z.string(), z.string()).optional(),
  /** Rôles et fonctionnalités installés (avec les outils de gestion). */
  features: z.array(z.string()).optional()
})

export const LabDomainSchema = z.object({
  name: z.string(),
  netbios: z.string().optional(),
  /** Serveur promu contrôleur du domaine. */
  dc: z.string(),
  ous: z.array(z.string()).default([]),
  groups: z
    .array(
      z.object({
        name: z.string(),
        ou: z.string().optional(),
        scope: z.enum(['DomainLocal', 'Global', 'Universal']).default('Global'),
        members: z.array(z.string()).default([])
      })
    )
    .default([]),
  users: z
    .array(
      z.object({
        name: z.string(),
        sam: z.string(),
        ou: z.string().optional(),
        password: z.string(),
        enabled: z.boolean().default(true)
      })
    )
    .default([]),
  /** Postes et serveurs joints au domaine (redémarrés). */
  join: z.array(z.string()).default([])
})

export const LabStartSchema = z.object({
  devices: z.array(LabDeviceSchema),
  /** Câbles entre ports : ["PC1:Ethernet0", "SW1:Fa0/1"]. */
  links: z.array(z.tuple([z.string(), z.string()])).default([]),
  domain: LabDomainSchema.optional()
})

export const LabDefinitionSchema = z.object({
  formatVersion: z.literal(LAB_FORMAT_VERSION),
  id: z.string(),
  title: z.string(),
  difficulty: z.enum(['Débutant', 'Intermédiaire', 'Avancé']),
  /** Durée indicative (« 20 min »). */
  duration: z.string(),
  summary: z.string(),
  /** Énoncé en Markdown (titres, listes, gras, code). */
  statement: z.string(),
  start: LabStartSchema,
  criteria: z.array(CriterionSchema).min(1)
})

export type LabDefinition = z.infer<typeof LabDefinitionSchema>
export type LabStart = z.infer<typeof LabStartSchema>

/** Valide un lab (fichier JSON) ; message d'erreur explicite si invalide. */
export function parseLab(raw: unknown): { ok: true; lab: LabDefinition } | { ok: false; message: string } {
  const parsed = LabDefinitionSchema.safeParse(raw)
  if (parsed.success) return { ok: true, lab: parsed.data }
  const issue = parsed.error.issues[0]
  return {
    ok: false,
    message: `Lab invalide${issue && issue.path.length > 0 ? ` (champ ${issue.path.join('.')})` : ''} : ${issue?.message ?? 'structure inattendue'}.`
  }
}

/** « 192.168.10.1/24 » → adresse et préfixe. */
function cidr(text: string): { address: string; mask: string } {
  const [address = '', prefix = '24'] = text.split('/')
  return { address, mask: prefix }
}

/** Construit l'état de départ d'un lab (lève une erreur si le lab est incohérent). */
export function buildLabStart(start: LabStart): LabState {
  let state = createLab()
  const ids = new Map<string, string>()
  const idOf = (name: string): string => {
    const id = ids.get(name.toLowerCase())
    if (!id) throw new Error(`Équipement « ${name} » inconnu dans le lab.`)
    return id
  }
  for (const d of start.devices) {
    const r = unwrap(addDevice(state, { kind: d.kind, position: { x: d.x, y: d.y }, name: d.name }))
    state = r.state
    ids.set(d.name.toLowerCase(), r.value)
  }
  const ifaceOf = (deviceId: string, name?: string) => {
    const device = state.devices[deviceId]
    const iface = name
      ? device?.interfaces.find((i) => i.name.toLowerCase() === name.toLowerCase())
      : device?.interfaces.find((i) => i.l3)
    if (!iface)
      throw new Error(`Port « ${name ?? '(premier)'} » introuvable sur ${device?.name ?? deviceId}.`)
    return iface.id
  }
  for (const [a, b] of start.links) {
    const [da = '', pa] = a.split(':')
    const [db = '', pb] = b.split(':')
    const left = { deviceId: idOf(da), ifaceId: ifaceOf(idOf(da), pa) }
    const right = { deviceId: idOf(db), ifaceId: ifaceOf(idOf(db), pb) }
    state = unwrap(connect(state, left, right)).state
  }
  for (const d of start.devices) {
    const id = idOf(d.name)
    for (const [port, address] of Object.entries(d.interfaces ?? {}))
      state = unwrap(
        setInterfaceIpv4(state, id, ifaceOf(id, port), {
          addressing: 'static',
          ...cidr(address),
          gateway: null,
          dnsServers: []
        })
      ).state
    if (d.ip)
      state = unwrap(
        setInterfaceIpv4(state, id, ifaceOf(id), {
          addressing: 'static',
          ...cidr(d.ip),
          gateway: d.gateway ?? null,
          dnsServers: d.dns ?? []
        })
      ).state
    else if (d.dhcp)
      state = unwrap(
        setInterfaceIpv4(state, id, ifaceOf(id), {
          addressing: 'dhcp',
          address: '',
          mask: '',
          gateway: null,
          dnsServers: []
        })
      ).state
    if (d.features?.length)
      state = unwrap(installFeatures(state, id, d.features, { includeManagementTools: true })).state
  }
  const domain = start.domain
  if (domain) {
    const dc = idOf(domain.dc)
    state = unwrap(installFeatures(state, dc, ['AD-Domain-Services'], { includeManagementTools: true })).state
    state = unwrap(
      installForest(state, dc, {
        domainName: domain.name,
        ...(domain.netbios ? { netbios: domain.netbios } : {}),
        safeModePassword: 'P@ssw0rd!'
      })
    ).state
    const dn = (ou?: string) =>
      [ou ? `OU=${ou}` : '', ...domain.name.split('.').map((p) => `DC=${p}`)].filter((x) => x).join(',')
    for (const ou of domain.ous) state = unwrap(addOrganizationalUnit(state, domain.name, { name: ou })).state
    for (const u of domain.users)
      state = unwrap(
        addUser(state, domain.name, {
          name: u.name,
          sam: u.sam,
          ...(u.ou ? { path: dn(u.ou) } : {}),
          upn: `${u.sam}@${domain.name}`,
          password: u.password,
          enabled: u.enabled
        })
      ).state
    for (const g of domain.groups) {
      state = unwrap(
        addGroup(state, domain.name, { name: g.name, scope: g.scope, ...(g.ou ? { path: dn(g.ou) } : {}) })
      ).state
      if (g.members.length > 0) state = unwrap(addGroupMembers(state, domain.name, g.name, g.members)).state
    }
    const netbios = state.domains[domain.name]?.netbios ?? ''
    const dcHost = state.devices[dc]
    const adminPassword = dcHost && dcHost.kind === 'server' ? dcHost.host.localAdminPassword : 'P@ssw0rd'
    for (const name of domain.join) {
      const id = idOf(name)
      const op = joinDomain(state, id, {
        domain: domain.name,
        user: `${netbios}\\Administrateur`,
        password: adminPassword
      })
      if (!op.ok) throw new Error(`Jonction de ${name} impossible : ${op.message}`)
      state = unwrap(restartComputer(op.state, id)).state
    }
  }
  return state
}

export interface LabProgress {
  results: CriterionResult[]
  passed: number
  total: number
}

/** Vérifie la progression d'un lab sur l'état courant. */
export function checkLab(state: LabState, lab: LabDefinition): LabProgress {
  const results = evaluateCriteria(state, lab.criteria)
  return { results, passed: results.filter((r) => r.ok).length, total: results.length }
}
