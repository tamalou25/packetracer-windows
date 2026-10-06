/**
 * Administration des objets de stratégie de groupe (console Gestion des stratégies de groupe
 * et module PowerShell GroupPolicy) : création, liaisons, héritage, statut, filtrage de
 * sécurité et modification des paramètres.
 */
import type { Draft } from 'immer'
import { bracedGuid, guidFromSeed } from '../../core/guid'
import { raise, transact, type EngineResult } from '../../core/result'
import { nextSeq } from '../../model/factory'
import type {
  Domain,
  DriveMap,
  GpLink,
  Gpo,
  GpoComputerSettings,
  GpoStatus,
  GpoUserSettings,
  LabState
} from '../../model/schema'
import { AUTHENTICATED_USERS_SID } from '../../model/schema'
import { containerDn, findPrincipal } from '../adds/directory'
import { requireDomain } from '../adds/objects'
import { newGpo } from './defaults'
import { findGpo } from './scope'

/** Noms acceptés pour le groupe bien connu « Utilisateurs authentifiés ». */
const AUTHENTICATED_USERS_NAMES = [
  'utilisateurs authentifiés',
  'authenticated users',
  'autorite nt\\utilisateurs authentifiés'
]

function requireGpo(domain: Draft<Domain>, nameOrId: string): Draft<Gpo> {
  const found = findGpo(domain as Domain, nameOrId)
  if (!found)
    raise(
      'GpoNotFound',
      `L’objet de stratégie de groupe « ${nameOrId} » est introuvable dans le domaine ${domain.name}.`
    )
  return domain.gpos.find((g) => g.id === found.id) as Draft<Gpo>
}

/** Liaisons modifiables d'une cible : racine du domaine (null) ou unité d'organisation. */
function linkTarget(domain: Draft<Domain>, targetId: string | null): { links: Draft<GpLink>[]; dn: string } {
  if (targetId === null) return { links: domain.gpLinks, dn: containerDn(domain as Domain, null) }
  const container = domain.containers.find((c) => c.id === targetId)
  if (!container) raise('TargetNotFound', 'Le conteneur cible est introuvable dans l’annuaire.')
  if (container.kind !== 'ou')
    raise(
      'InvalidLinkTarget',
      `Les objets de stratégie de groupe ne peuvent être liés qu’à un site, à un domaine ou à une unité d’organisation : « ${container.name} » est un conteneur.`
    )
  return { links: container.gpLinks, dn: containerDn(domain as Domain, targetId) }
}

function validName(domain: Draft<Domain>, name: string, exceptId?: string): string {
  const trimmed = name.trim()
  if (!trimmed) raise('InvalidName', 'Le nom de l’objet de stratégie de groupe est obligatoire.')
  if (trimmed.length > 255) raise('InvalidName', 'Le nom ne doit pas dépasser 255 caractères.')
  if (domain.gpos.some((g) => g.id !== exceptId && g.name.toLowerCase() === trimmed.toLowerCase()))
    raise(
      'GpoExists',
      `Un objet de stratégie de groupe nommé « ${trimmed} » existe déjà dans le domaine ${domain.name}.`
    )
  return trimmed
}

function touch(draft: Draft<LabState>, gpo: Draft<Gpo>): void {
  gpo.modifiedAt = draft.clock
}

/** Crée une GPO vide ; renvoie son GUID ({…}). */
export function createGpo(
  state: LabState,
  domainName: string,
  input: { name: string; comment?: string }
): EngineResult<string> {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const name = validName(domain, input.name)
    const id = bracedGuid(guidFromSeed(`gpo${nextSeq(draft)}`))
    const gpo = newGpo(id, name, draft.clock)
    gpo.comment = input.comment ?? ''
    domain.gpos.push(gpo)
    return id
  })
}

export function renameGpo(state: LabState, domainName: string, gpoId: string, newName: string): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const gpo = requireGpo(domain, gpoId)
    gpo.name = validName(domain, newName, gpo.id)
    touch(draft, gpo)
    return undefined
  })
}

/** Supprime une GPO et toutes ses liaisons dans le domaine. */
export function deleteGpo(state: LabState, domainName: string, gpoId: string): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const gpo = requireGpo(domain, gpoId)
    domain.gpos = domain.gpos.filter((g) => g.id !== gpo.id)
    domain.gpLinks = domain.gpLinks.filter((l) => l.gpoId !== gpo.id)
    for (const c of domain.containers) c.gpLinks = c.gpLinks.filter((l) => l.gpoId !== gpo.id)
    return undefined
  })
}

export function setGpoStatus(
  state: LabState,
  domainName: string,
  gpoId: string,
  status: GpoStatus
): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const gpo = requireGpo(domain, gpoId)
    gpo.status = status
    touch(draft, gpo)
    return undefined
  })
}

export interface LinkOptions {
  enabled?: boolean
  enforced?: boolean
  /** Ordre de liaison souhaité (1 = prioritaire). */
  order?: number
}

/** Lie une GPO à la racine du domaine (null) ou à une OU ; renvoie l'ordre de liaison. */
export function linkGpo(
  state: LabState,
  domainName: string,
  gpoId: string,
  targetId: string | null,
  options: LinkOptions = {}
): EngineResult<number> {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const gpo = requireGpo(domain, gpoId)
    const { links, dn } = linkTarget(domain, targetId)
    if (links.some((l) => l.gpoId === gpo.id))
      raise('AlreadyLinked', `L’objet de stratégie de groupe « ${gpo.name} » est déjà lié à « ${dn} ».`)
    const link: GpLink = {
      gpoId: gpo.id,
      enabled: options.enabled ?? true,
      enforced: options.enforced ?? false
    }
    const index =
      options.order === undefined ? links.length : Math.min(Math.max(options.order, 1), links.length + 1) - 1
    links.splice(index, 0, link)
    return index + 1
  })
}

/** Modifie une liaison existante : lien activé, appliqué, ordre de liaison. */
export function updateGpoLink(
  state: LabState,
  domainName: string,
  gpoId: string,
  targetId: string | null,
  options: LinkOptions
): EngineResult<number> {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const gpo = requireGpo(domain, gpoId)
    const { links, dn } = linkTarget(domain, targetId)
    let index = links.findIndex((l) => l.gpoId === gpo.id)
    const link = links[index]
    if (!link)
      raise('LinkNotFound', `L’objet de stratégie de groupe « ${gpo.name} » n’est pas lié à « ${dn} ».`)
    if (options.enabled !== undefined) link.enabled = options.enabled
    if (options.enforced !== undefined) link.enforced = options.enforced
    if (options.order !== undefined) {
      const target = Math.min(Math.max(options.order, 1), links.length) - 1
      const [moved] = links.splice(index, 1)
      if (moved) links.splice(target, 0, moved)
      index = target
    }
    return index + 1
  })
}

/** Supprime une liaison (la GPO elle-même est conservée). */
export function unlinkGpo(
  state: LabState,
  domainName: string,
  gpoId: string,
  targetId: string | null
): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const gpo = requireGpo(domain, gpoId)
    const { links, dn } = linkTarget(domain, targetId)
    const index = links.findIndex((l) => l.gpoId === gpo.id)
    if (index < 0)
      raise('LinkNotFound', `L’objet de stratégie de groupe « ${gpo.name} » n’est pas lié à « ${dn} ».`)
    links.splice(index, 1)
    return undefined
  })
}

/** Bloque (ou non) l'héritage des GPO des conteneurs parents sur une OU. */
export function setInheritanceBlocked(
  state: LabState,
  domainName: string,
  targetId: string,
  blocked: boolean
): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const container = domain.containers.find((c) => c.id === targetId)
    if (!container || container.kind !== 'ou')
      raise('InvalidTarget', 'Le blocage de l’héritage ne s’applique qu’à une unité d’organisation.')
    container.blockInheritance = blocked
    return undefined
  })
}

/** Identifiant de filtrage (SID bien connu ou objet de l'annuaire) désigné par un nom. */
export function resolveFilterPrincipal(domain: Domain, identity: string): string | undefined {
  const lower = identity.trim().toLowerCase()
  if (lower === AUTHENTICATED_USERS_SID.toLowerCase() || AUTHENTICATED_USERS_NAMES.includes(lower))
    return AUTHENTICATED_USERS_SID
  const found = findPrincipal(domain, identity)
  return found && found.kind !== 'container' ? found.obj.id : undefined
}

/**
 * Filtrage de sécurité : accorde (`apply`) ou retire le droit « Appliquer la stratégie de groupe »
 * à un utilisateur, un groupe, un ordinateur ou aux Utilisateurs authentifiés.
 */
export function setGpoSecurityFilter(
  state: LabState,
  domainName: string,
  gpoId: string,
  identity: string,
  apply: boolean
): EngineResult<string> {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const gpo = requireGpo(domain, gpoId)
    const principal = resolveFilterPrincipal(domain as Domain, identity)
    if (!principal)
      raise('PrincipalNotFound', `Le compte « ${identity} » est introuvable dans le domaine ${domain.name}.`)
    const present = gpo.securityFilter.includes(principal)
    if (apply && !present) gpo.securityFilter.push(principal)
    if (!apply && present) gpo.securityFilter = gpo.securityFilter.filter((p) => p !== principal)
    touch(draft, gpo)
    return principal
  })
}

function validDriveMap(map: DriveMap): DriveMap {
  const letter = map.letter.trim().replace(/:$/, '').toUpperCase()
  if (!/^[A-Z]$/.test(letter))
    raise('InvalidDrive', `La lettre de lecteur « ${map.letter} » n’est pas valide.`)
  const path = map.path.trim()
  if (map.action !== 'Delete' && !/^\\\\[^\\]+\\[^\\]+/.test(path))
    raise(
      'InvalidPath',
      `L’emplacement « ${map.path} » n’est pas un chemin réseau valide (\\\\serveur\\partage).`
    )
  return { ...map, letter, path }
}

export interface GpoSettingsPatch {
  computer?: Partial<GpoComputerSettings>
  user?: Partial<GpoUserSettings>
}

/** Modifie des paramètres d'une GPO ; incrémente la version de la partie concernée. */
export function updateGpoSettings(
  state: LabState,
  domainName: string,
  gpoId: string,
  patch: GpoSettingsPatch
): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const gpo = requireGpo(domain, gpoId)
    if (patch.computer) {
      const length = patch.computer.minPasswordLength
      if (length !== undefined && length !== null && (!Number.isInteger(length) || length < 0 || length > 14))
        raise(
          'InvalidValue',
          'La longueur minimale du mot de passe doit être un nombre entier compris entre 0 et 14 caractères.'
        )
      Object.assign(gpo.computer, patch.computer)
      gpo.computerVersion += 1
    }
    if (patch.user) {
      const { driveMaps, ...rest } = patch.user
      Object.assign(gpo.user, rest)
      if (driveMaps) gpo.user.driveMaps = driveMaps.map(validDriveMap)
      gpo.userVersion += 1
    }
    touch(draft, gpo)
    return undefined
  })
}
