/**
 * Labs pédagogiques : format JSON (énoncé, topologie de départ, critères) et construction de
 * l'état de départ avec les actions du moteur (déterministe : même lab = même état).
 */
import { z } from 'zod'
import { command, type Command, type CommandType, type CommandValue } from '../commands/catalog'
import { dispatch } from '../commands/dispatch'
import { createLab } from '../model/factory'
import { DEVICE_KINDS } from '../model/kinds'
import type { LabState } from '../model/schema'
import { FIREWALL_PROFILES } from '../model/schema'
import { localToken } from '../roles/files/acl'
import { DEFAULT_DOMAIN_POLICY_ID } from '../roles/gpo/defaults'
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
  /**
   * Adresses par carte : { "Gi0/0": "192.168.10.254/24" } ; passerelle facultative après une
   * espace : { "Ethernet1": "203.0.113.2/24 203.0.113.1" }.
   */
  interfaces: z.record(z.string(), z.string()).optional(),
  /** Nombre de cartes réseau d'un serveur (Ethernet0, Ethernet1…). */
  nics: z.number().int().min(1).max(4).optional(),
  /** Rôles et fonctionnalités installés (avec les outils de gestion). */
  features: z.array(z.string()).optional(),
  /** Protocole SMB 1.0 activé (labs de durcissement). */
  smb1: z.boolean().optional(),
  /** Profils du pare-feu désactivés. */
  firewallDisabled: z.array(z.enum(FIREWALL_PROFILES)).optional(),
  /** Dossiers partagés (créés au besoin) : comptes par niveau d'autorisation. */
  shares: z
    .array(
      z.object({
        name: z.string(),
        path: z.string(),
        full: z.array(z.string()).optional(),
        change: z.array(z.string()).optional(),
        read: z.array(z.string()).optional()
      })
    )
    .optional()
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
        enabled: z.boolean().default(true),
        passwordNeverExpires: z.boolean().optional(),
        /** Groupes existants (Admins du domaine…) dont le compte est membre. */
        memberOf: z.array(z.string()).optional(),
        /** Compte créé il y a N jours ; dernière ouverture de session il y a N jours (null : jamais). */
        createdDaysAgo: z.number().int().nonnegative().optional(),
        lastLogonDaysAgo: z.number().int().nonnegative().nullable().optional()
      })
    )
    .default([]),
  /** Stratégie de mot de passe de la Default Domain Policy. */
  passwordPolicy: z
    .object({ minLength: z.number().int().min(0).max(14).optional(), complexity: z.boolean().optional() })
    .optional(),
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

export type LabParseResult = { ok: true; lab: LabDefinition } | { ok: false; message: string }

/** Taille maximale d'un fichier de lab (texte JSON). */
export const MAX_LAB_LENGTH = 1024 * 1024

/**
 * Valide le texte d'un fichier de lab (import, bibliothèque) : taille, JSON puis schéma.
 * Un lab n'est que des données : aucun contenu n'est exécuté ni interprété comme du HTML.
 */
export function parseLabText(text: string): LabParseResult {
  if (text.length > MAX_LAB_LENGTH) return { ok: false, message: 'Lab invalide : fichier trop volumineux.' }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, message: 'Lab invalide : JSON illisible.' }
  }
  return parseLab(raw)
}

/**
 * Valide un lab (objet JSON) ; message d'erreur explicite si invalide. Les champs inconnus sont
 * ignorés et retirés du résultat.
 */
export function parseLab(raw: unknown): LabParseResult {
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
  const [address = '', prefix = '24'] = (text.trim().split(/\s+/)[0] ?? '').split('/')
  return { address, mask: prefix }
}

/** Passerelle facultative après l'adresse : « 203.0.113.2/24 203.0.113.1 ». */
const gatewayOf = (text: string): string | null => text.trim().split(/\s+/)[1] ?? null

/** Construit l'état de départ d'un lab (lève une erreur si le lab est incohérent). */
export function buildLabStart(start: LabStart): LabState {
  let state = createLab()
  /** Applique une commande (mêmes commandes que l'interface et les consoles) ou lève une erreur. */
  const apply = <K extends CommandType>(cmd: Command<K>): CommandValue<K> => {
    const r = dispatch(state, cmd)
    if (!r.ok) throw new Error(`[${r.error.code}] ${r.error.message}`)
    state = r.state
    return r.value
  }
  const ids = new Map<string, string>()
  const idOf = (name: string): string => {
    const id = ids.get(name.toLowerCase())
    if (!id) throw new Error(`Équipement « ${name} » inconnu dans le lab.`)
    return id
  }
  for (const d of start.devices) {
    const id = apply(
      command('topology.addDevice', { kind: d.kind, position: { x: d.x, y: d.y }, name: d.name })
    )
    ids.set(d.name.toLowerCase(), id)
    if (d.kind === 'server')
      for (let n = 1; n < (d.nics ?? 1); n++) apply(command('topology.addServerInterface', id))
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
    apply(command('topology.connect', left, right))
  }
  for (const d of start.devices) {
    const id = idOf(d.name)
    for (const [port, address] of Object.entries(d.interfaces ?? {}))
      apply(
        command('net.setInterfaceIpv4', id, ifaceOf(id, port), {
          addressing: 'static',
          ...cidr(address),
          gateway: gatewayOf(address),
          dnsServers: []
        })
      )
    if (d.ip)
      apply(
        command('net.setInterfaceIpv4', id, ifaceOf(id), {
          addressing: 'static',
          ...cidr(d.ip),
          gateway: d.gateway ?? null,
          dnsServers: d.dns ?? []
        })
      )
    else if (d.dhcp)
      apply(
        command('net.setInterfaceIpv4', id, ifaceOf(id), {
          addressing: 'dhcp',
          address: '',
          mask: '',
          gateway: null,
          dnsServers: []
        })
      )
    if (d.features?.length)
      apply(command('system.installFeatures', id, d.features, { includeManagementTools: true }))
    if (d.smb1) apply(command('files.setSmb1', id, true))
    if (d.firewallDisabled?.length)
      apply(command('firewall.setProfile', id, d.firewallDisabled, { enabled: false }))
    for (const share of d.shares ?? [])
      apply(
        command(
          'files.shareFolder',
          id,
          {
            name: share.name,
            path: share.path,
            ...(share.full ? { full: share.full } : {}),
            ...(share.change ? { change: share.change } : {}),
            ...(share.read ? { read: share.read } : {})
          },
          localToken(d.name, 'Administrateur')
        )
      )
  }
  const domain = start.domain
  if (domain) {
    const dc = idOf(domain.dc)
    apply(command('system.installFeatures', dc, ['AD-Domain-Services'], { includeManagementTools: true }))
    apply(
      command('adds.installForest', dc, {
        domainName: domain.name,
        ...(domain.netbios ? { netbios: domain.netbios } : {}),
        safeModePassword: 'P@ssw0rd!'
      })
    )
    const dn = (ou?: string) =>
      [ou ? `OU=${ou}` : '', ...domain.name.split('.').map((p) => `DC=${p}`)].filter((x) => x).join(',')
    for (const ou of domain.ous) apply(command('adds.addOrganizationalUnit', domain.name, { name: ou }))
    for (const u of domain.users)
      apply(
        command('adds.addUser', domain.name, {
          name: u.name,
          sam: u.sam,
          ...(u.ou ? { path: dn(u.ou) } : {}),
          upn: `${u.sam}@${domain.name}`,
          password: u.password,
          enabled: u.enabled,
          ...(u.passwordNeverExpires ? { passwordNeverExpires: true } : {})
        })
      )
    for (const g of domain.groups) {
      apply(
        command('adds.addGroup', domain.name, {
          name: g.name,
          scope: g.scope,
          ...(g.ou ? { path: dn(g.ou) } : {})
        })
      )
      if (g.members.length > 0) apply(command('adds.addGroupMembers', domain.name, g.name, g.members))
    }
    for (const u of domain.users) {
      for (const group of u.memberOf ?? [])
        apply(command('adds.addGroupMembers', domain.name, group, [u.sam]))
      if (u.createdDaysAgo !== undefined || u.lastLogonDaysAgo !== undefined)
        apply(
          command('adds.setAccountActivity', domain.name, u.sam, {
            ...(u.createdDaysAgo !== undefined ? { createdDaysAgo: u.createdDaysAgo } : {}),
            ...(u.lastLogonDaysAgo !== undefined ? { lastLogonDaysAgo: u.lastLogonDaysAgo } : {})
          })
        )
    }
    if (domain.passwordPolicy)
      apply(
        command('gpo.updateSettings', domain.name, DEFAULT_DOMAIN_POLICY_ID, {
          computer: {
            ...(domain.passwordPolicy.minLength !== undefined
              ? { minPasswordLength: domain.passwordPolicy.minLength }
              : {}),
            ...(domain.passwordPolicy.complexity !== undefined
              ? { passwordComplexity: domain.passwordPolicy.complexity }
              : {})
          }
        })
      )
    const netbios = state.domains[domain.name]?.netbios ?? ''
    const dcHost = state.devices[dc]
    const adminPassword = dcHost && dcHost.kind === 'server' ? dcHost.host.localAdminPassword : 'P@ssw0rd'
    for (const name of domain.join) {
      const id = idOf(name)
      const joined = apply(
        command('adds.joinDomain', id, {
          domain: domain.name,
          user: `${netbios}\\Administrateur`,
          password: adminPassword
        })
      )
      if (!joined.success) throw new Error(`Jonction de ${name} impossible : ${joined.message}`)
      apply(command('system.restartComputer', id))
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
