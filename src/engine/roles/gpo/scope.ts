/**
 * Étendue des stratégies de groupe et jeu de stratégie résultant (RSoP) :
 * ordre de traitement (domaine puis OU parentes jusqu'à l'OU de l'objet), ordre des liaisons,
 * blocage de l'héritage, liaisons appliquées, statut des GPO et filtrage de sécurité.
 */
import type { Domain, DriveMap, GpLink, Gpo, GpoComputerSettings, GpoUserSettings } from '../../model/schema'
import { AUTHENTICATED_USERS_SID } from '../../model/schema'
import { findContainer, groupsOf, type PasswordPolicy } from '../adds/directory'
import { emptyComputerSettings, emptyUserSettings } from './defaults'

export type PolicyPart = 'computer' | 'user'

/** Une liaison de GPO vue depuis un conteneur. */
export interface ScopedLink {
  gpo: Gpo
  link: GpLink
  /** Conteneur portant la liaison (null = racine du domaine). */
  targetId: string | null
  /** Emplacement lisible : lab.local, lab.local/Compta… */
  location: string
  /** Ordre de liaison dans le conteneur (1 = prioritaire). */
  order: number
}

/** Raisons de filtrage, telles qu'affichées par gpresult. */
export const FILTER_REASONS = {
  link: 'Désactivé (Lien)',
  gpo: 'Désactivé (GPO)',
  security: 'Refusé (Sécurité)',
  empty: 'Non appliqué (vide)'
} as const

/** GUID normalisé ({…} en majuscules) pour comparer des identifiants saisis. */
export function normalizeGpoId(value: string): string {
  return `{${value
    .trim()
    .replace(/^\{|\}$/g, '')
    .toUpperCase()}}`
}

/** GPO désignée par son nom ou son GUID (avec ou sans accolades). */
export function findGpo(domain: Domain, nameOrId: string): Gpo | undefined {
  const value = nameOrId.trim()
  const id = normalizeGpoId(value)
  return (
    domain.gpos.find((g) => g.id === id) ??
    domain.gpos.find((g) => g.name.toLowerCase() === value.toLowerCase())
  )
}

/** Liaisons portées par la racine du domaine (null) ou par une OU. */
export function linksAt(domain: Domain, targetId: string | null): GpLink[] {
  if (targetId === null) return domain.gpLinks
  return findContainer(domain, targetId)?.gpLinks ?? []
}

/** Chemin canonique « lab.local/Compta/Paris » d'un conteneur (null = racine). */
export function containerPath(domain: Domain, id: string | null): string {
  const parts: string[] = []
  let current = findContainer(domain, id)
  while (current) {
    parts.unshift(current.name)
    current = findContainer(domain, current.parentId)
  }
  return [domain.name, ...parts].join('/')
}

/** Toutes les liaisons d'une GPO dans le domaine (onglet « Étendue » de la console). */
export function linksOfGpo(domain: Domain, gpoId: string): ScopedLink[] {
  const gpo = domain.gpos.find((g) => g.id === gpoId)
  if (!gpo) return []
  const targets: (string | null)[] = [null, ...domain.containers.map((c) => c.id)]
  return targets.flatMap((targetId) =>
    linksAt(domain, targetId).flatMap((link, k) =>
      link.gpoId === gpoId
        ? [{ gpo, link, targetId, location: containerPath(domain, targetId), order: k + 1 }]
        : []
    )
  )
}

/** Conteneurs de la racine du domaine (null) jusqu'au conteneur donné, inclus. */
function lineage(domain: Domain, id: string | null): (string | null)[] {
  const chain: (string | null)[] = []
  let current = findContainer(domain, id)
  while (current) {
    chain.unshift(current.id)
    current = findContainer(domain, current.parentId)
  }
  return [null, ...chain]
}

/**
 * GPO dans l'étendue d'un conteneur, de la plus prioritaire à la moins prioritaire
 * (onglet « Héritage de stratégie de groupe ») :
 * 1. liaisons appliquées, la plus proche du domaine l'emportant ;
 * 2. liaisons ordinaires, du conteneur le plus proche de l'objet au plus éloigné,
 *    en s'arrêtant à l'OU qui bloque l'héritage.
 * Les liens désactivés ne sont inclus que sur demande (gpresult les signale comme filtrés).
 */
export function gpoPrecedence(
  domain: Domain,
  containerId: string | null,
  includeDisabled = false
): ScopedLink[] {
  const chain = lineage(domain, containerId)
  let start = 0
  for (let i = chain.length - 1; i > 0; i--) {
    if (findContainer(domain, chain[i] ?? null)?.blockInheritance) {
      start = i
      break
    }
  }
  const entriesAt = (i: number): ScopedLink[] => {
    const targetId = chain[i] ?? null
    return linksAt(domain, targetId).flatMap((link, k) => {
      const gpo = domain.gpos.find((g) => g.id === link.gpoId)
      if (!gpo || (!includeDisabled && !link.enabled)) return []
      return [{ gpo, link, targetId, location: containerPath(domain, targetId), order: k + 1 }]
    })
  }
  const enforced = chain.flatMap((_, i) => entriesAt(i).filter((e) => e.link.enforced))
  const inherited: ScopedLink[] = []
  for (let i = chain.length - 1; i >= start; i--)
    inherited.push(...entriesAt(i).filter((e) => !e.link.enforced))
  return [...enforced, ...inherited]
}

/** La partie (ordinateur/utilisateur) de la GPO est-elle activée par son statut ? */
export function partEnabled(gpo: Gpo, part: PolicyPart): boolean {
  if (gpo.status === 'AllSettingsDisabled') return false
  if (part === 'user') return gpo.status !== 'UserSettingsDisabled'
  return gpo.status !== 'ComputerSettingsDisabled'
}

/** Filtrage de sécurité : le compte (ou l'un de ses groupes) a-t-il le droit d'appliquer la GPO ? */
export function gpoAppliesTo(domain: Domain, gpo: Gpo, principalId: string): boolean {
  if (gpo.securityFilter.includes(AUTHENTICATED_USERS_SID)) return true
  if (gpo.securityFilter.includes(principalId)) return true
  return groupsOf(domain, principalId).some((g) => gpo.securityFilter.includes(g.id))
}

export interface RsopEntry {
  gpo: Gpo
  location: string
}

export interface RsopFiltered extends RsopEntry {
  reason: string
}

export interface Rsop<S> {
  /** GPO appliquées, de la plus prioritaire à la moins prioritaire. */
  applied: RsopEntry[]
  filtered: RsopFiltered[]
  /** Paramètres résultants (la GPO la plus prioritaire l'emporte). */
  settings: S
}

/** Classe les GPO de l'étendue d'un objet en appliquées / filtrées. */
function scopeOf(
  domain: Domain,
  part: PolicyPart,
  principalId: string,
  parentId: string | null
): { applied: RsopEntry[]; filtered: RsopFiltered[] } {
  const applied: RsopEntry[] = []
  const filtered: RsopFiltered[] = []
  for (const entry of gpoPrecedence(domain, parentId, true)) {
    const { gpo, link } = entry
    if (applied.some((a) => a.gpo.id === gpo.id)) continue
    let reason: string | null = null
    if (!link.enabled) reason = FILTER_REASONS.link
    else if (!partEnabled(gpo, part)) reason = FILTER_REASONS.gpo
    else if (!gpoAppliesTo(domain, gpo, principalId)) reason = FILTER_REASONS.security
    else if ((part === 'user' ? gpo.userVersion : gpo.computerVersion) === 0) reason = FILTER_REASONS.empty
    if (reason === null) {
      applied.push({ gpo, location: entry.location })
      const i = filtered.findIndex((f) => f.gpo.id === gpo.id)
      if (i >= 0) filtered.splice(i, 1)
    } else if (!filtered.some((f) => f.gpo.id === gpo.id)) {
      filtered.push({ gpo, location: entry.location, reason })
    }
  }
  return { applied, filtered }
}

/** Applique une préférence de lecteur mappé (Créer, Remplacer, Mettre à jour, Supprimer). */
export function applyDriveMap(list: DriveMap[], map: DriveMap): DriveMap[] {
  const letter = map.letter.toUpperCase()
  const same = (d: DriveMap) => d.letter.toUpperCase() === letter
  const existing = list.find(same)
  const created: DriveMap = { ...map, letter, action: 'Update' }
  switch (map.action) {
    case 'Delete':
      return list.filter((d) => !same(d))
    case 'Create':
      return existing ? list : [...list, created]
    case 'Replace':
      return [...list.filter((d) => !same(d)), created]
    case 'Update':
      return existing
        ? list.map((d) =>
            same(d)
              ? { ...d, path: map.path || d.path, label: map.label || d.label, reconnect: map.reconnect }
              : d
          )
        : [...list, created]
  }
}

function mergeComputer(target: GpoComputerSettings, s: GpoComputerSettings): void {
  if (s.minPasswordLength !== null) target.minPasswordLength = s.minPasswordLength
  if (s.passwordComplexity !== null) target.passwordComplexity = s.passwordComplexity
  if (s.logonMessageTitle !== null) target.logonMessageTitle = s.logonMessageTitle
  if (s.logonMessageText !== null) target.logonMessageText = s.logonMessageText
  if (s.wuServer.state !== 'NotConfigured') target.wuServer = { ...s.wuServer }
  if (s.wuTargetGroup.state !== 'NotConfigured') target.wuTargetGroup = { ...s.wuTargetGroup }
  if (s.autoEnrollment !== 'NotConfigured') target.autoEnrollment = s.autoEnrollment
  if (s.firewallDomain !== 'NotConfigured') target.firewallDomain = s.firewallDomain
  if (s.firewallStandard !== 'NotConfigured') target.firewallStandard = s.firewallStandard
  for (const key of [
    'lockoutThreshold',
    'lockoutDuration',
    'lockoutReset',
    'auditLogon',
    'auditAccountManagement'
  ] as const)
    if (s[key] !== null) (target as Record<typeof key, unknown>)[key] = s[key]
  // Les règles de toutes les GPO s'additionnent (la plus prioritaire l'emporte à nom égal)
  for (const rule of s.firewallRules)
    target.firewallRules = [...target.firewallRules.filter((r) => r.id !== rule.id), { ...rule }]
}

function mergeUser(target: GpoUserSettings, s: GpoUserSettings): void {
  if (s.wallpaper.state !== 'NotConfigured') target.wallpaper = { ...s.wallpaper }
  for (const key of ['noControlPanel', 'noRun', 'noCmd'] as const)
    if (s[key] !== 'NotConfigured') target[key] = s[key]
  for (const map of s.driveMaps) target.driveMaps = applyDriveMap(target.driveMaps, map)
}

/** Stratégie d'ordinateur résultante d'un compte d'ordinateur du domaine. */
export function computerRsop(
  domain: Domain,
  computer: { id: string; parentId: string | null }
): Rsop<GpoComputerSettings> {
  const scope = scopeOf(domain, 'computer', computer.id, computer.parentId)
  const settings = emptyComputerSettings()
  // Application de la moins prioritaire à la plus prioritaire : la dernière l'emporte
  for (const { gpo } of [...scope.applied].reverse()) mergeComputer(settings, gpo.computer)
  return { ...scope, settings }
}

/** Stratégie utilisateur résultante d'un compte d'utilisateur du domaine. */
export function userRsop(
  domain: Domain,
  user: { id: string; parentId: string | null }
): Rsop<GpoUserSettings> {
  const scope = scopeOf(domain, 'user', user.id, user.parentId)
  const settings = emptyUserSettings()
  for (const { gpo } of [...scope.applied].reverse()) mergeUser(settings, gpo.user)
  settings.driveMaps.sort((a, b) => a.letter.localeCompare(b.letter))
  return { ...scope, settings }
}

/**
 * Stratégie de mot de passe du domaine : seules les GPO liées à la racine du domaine
 * s'appliquent aux comptes du domaine (paramètres de la plus prioritaire).
 */
export function domainPasswordPolicy(domain: Domain): PasswordPolicy {
  const dc = domain.computers.find((c) => c.deviceId !== null && domain.controllers.includes(c.deviceId))
  let minLength: number | null = null
  let complexity: boolean | null = null
  for (const { gpo } of gpoPrecedence(domain, null)) {
    if (!partEnabled(gpo, 'computer') || (dc && !gpoAppliesTo(domain, gpo, dc.id))) continue
    if (minLength === null) minLength = gpo.computer.minPasswordLength
    if (complexity === null) complexity = gpo.computer.passwordComplexity
  }
  return { minLength: minLength ?? 0, complexity: complexity ?? false }
}

export interface LockoutPolicy {
  /** Nombre d'échecs avant verrouillage (0 : jamais). */
  threshold: number
  /** Durée du verrouillage en minutes (0 : jusqu'au déverrouillage par un administrateur). */
  duration: number
  /** Délai de remise à zéro du compteur d'échecs, en minutes. */
  reset: number
}

/**
 * Stratégie de verrouillage du domaine : comme la stratégie de mot de passe, seules les GPO liées
 * à la racine du domaine s'appliquent aux comptes du domaine.
 */
export function domainLockoutPolicy(domain: Domain): LockoutPolicy {
  const dc = domain.computers.find((c) => c.deviceId !== null && domain.controllers.includes(c.deviceId))
  let threshold: number | null = null
  let duration: number | null = null
  let reset: number | null = null
  for (const { gpo } of gpoPrecedence(domain, null)) {
    if (!partEnabled(gpo, 'computer') || (dc && !gpoAppliesTo(domain, gpo, dc.id))) continue
    if (threshold === null) threshold = gpo.computer.lockoutThreshold
    if (duration === null) duration = gpo.computer.lockoutDuration
    if (reset === null) reset = gpo.computer.lockoutReset
  }
  return { threshold: threshold ?? 0, duration: duration ?? 30, reset: reset ?? 30 }
}
