/**
 * Gestion des objets de l'annuaire : unités d'organisation, utilisateurs, groupes, membres.
 */
import type { Draft } from 'immer'
import { logEvent } from '../../core/eventlog'
import { raise, transact, type EngineResult } from '../../core/result'
import type { AdGroup, Domain, LabState } from '../../model/schema'
import {
  assertNameAvailable,
  assertSamAvailable,
  defaultContainer,
  domainDn,
  findPrincipal,
  newAdId,
  objectById,
  passwordMeetsPolicy,
  PASSWORD_POLICY_ERROR,
  resolveContainerDn,
  type AdObject
} from './directory'
import { domainPasswordPolicy } from '../gpo/scope'

export function requireDomain(draft: Draft<LabState>, name: string): Draft<Domain> {
  const domain = draft.domains[name.toLowerCase()]
  if (!domain) raise('DomainNotFound', `Le domaine ${name} est introuvable.`)
  return domain
}

/** Conteneur cible d'un -Path (DN) ; à défaut le conteneur par défaut. */
function targetContainer(
  domain: Draft<Domain>,
  path: string | undefined,
  fallback: 'Users' | 'Computers' | null
): string | null {
  if (!path || path.trim() === '') return fallback ? defaultContainer(domain as Domain, fallback) : null
  const resolved = resolveContainerDn(domain as Domain, path)
  if (resolved === undefined)
    raise(
      'DirectoryObjectNotFound',
      `Objet de répertoire non trouvé : « ${path} » n’existe pas sous « ${domainDn(domain)} ».`
    )
  return resolved
}

function notFound(domain: Domain, identity: string): never {
  raise(
    'ADIdentityNotFound',
    `Impossible de trouver un objet avec l’identité « ${identity} » sous « ${domainDn(domain)} ».`
  )
}

export interface OuInput {
  name: string
  path?: string
  description?: string
  protectedFromDeletion?: boolean
}

export function addOrganizationalUnit(
  state: LabState,
  domainName: string,
  input: OuInput
): EngineResult<string> {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const name = input.name.trim()
    if (!name || /[,=+<>#;"\\]/.test(name))
      raise('InvalidName', `Le nom « ${input.name} » n’est pas valide pour une unité d’organisation.`)
    const parentId = targetContainer(domain, input.path, null)
    assertNameAvailable(domain, parentId, name)
    const id = newAdId(draft)
    domain.containers.push({
      id,
      name,
      parentId,
      kind: 'ou',
      description: input.description ?? '',
      protected: input.protectedFromDeletion ?? true,
      builtin: false,
      gpLinks: [],
      blockInheritance: false
    })
    return id
  })
}

export interface UserInput {
  name: string
  sam?: string
  givenName?: string
  surname?: string
  upn?: string
  path?: string
  password?: string
  enabled?: boolean
  mustChangePassword?: boolean
  description?: string
}

export interface UserResult {
  id: string
  /** Erreur de mot de passe : le compte est créé mais reste désactivé (comportement réel). */
  passwordError: string | null
}

export function addUser(
  state: LabState,
  domainName: string,
  input: UserInput,
  logOn?: string
): EngineResult<UserResult> {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const name = input.name.trim()
    if (!name) raise('InvalidName', 'Le nom de l’utilisateur est obligatoire.')
    const sam = (input.sam?.trim() || name).slice(0, 20)
    if (/["/\\[\]:;|=,+*?<>@]/.test(sam))
      raise('InvalidSam', `Le nom d’ouverture de session « ${sam} » contient des caractères non autorisés.`)
    const parentId = targetContainer(domain, input.path, 'Users')
    if (parentId === null)
      raise('InvalidPath', 'Un utilisateur doit être créé dans un conteneur ou une unité d’organisation.')
    assertSamAvailable(domain, sam)
    assertNameAvailable(domain, parentId, name)
    let passwordError: string | null = null
    const password = input.password ?? ''
    let enabled = input.enabled ?? false
    if (enabled || password) {
      if (!passwordMeetsPolicy(password, sam, domainPasswordPolicy(domain as Domain))) {
        passwordError = PASSWORD_POLICY_ERROR
        enabled = false
      }
    }
    const id = newAdId(draft)
    domain.users.push({
      id,
      sam,
      name,
      givenName: input.givenName ?? '',
      surname: input.surname ?? '',
      upn: input.upn ?? '',
      parentId,
      password: passwordError ? '' : password,
      enabled,
      mustChangePassword: !!input.mustChangePassword,
      description: input.description ?? '',
      builtin: false
    })
    // Groupe principal : Utilisateurs du domaine
    domain.groups.find((g) => g.name === 'Utilisateurs du domaine')?.members.push(id)
    const dc = domain.controllers[0]
    if (dc)
      logEvent(draft, dc, {
        level: 'information',
        source: 'Security-Auditing',
        eventId: 4720,
        log: 'Sécurité',
        message: `Un compte d’utilisateur a été créé. Nouveau compte : ${domain.netbios}\\${sam}${logOn ? ` (par ${logOn})` : ''}.`
      })
    return { id, passwordError }
  })
}

export interface GroupInput {
  name: string
  sam?: string
  scope: AdGroup['scope']
  category?: AdGroup['category']
  path?: string
  description?: string
}

export function addGroup(state: LabState, domainName: string, input: GroupInput): EngineResult<string> {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const name = input.name.trim()
    if (!name) raise('InvalidName', 'Le nom du groupe est obligatoire.')
    const sam = (input.sam?.trim() || name).slice(0, 63)
    const parentId = targetContainer(domain, input.path, 'Users')
    if (parentId === null)
      raise('InvalidPath', 'Un groupe doit être créé dans un conteneur ou une unité d’organisation.')
    assertSamAvailable(domain, sam)
    assertNameAvailable(domain, parentId, name)
    const id = newAdId(draft)
    domain.groups.push({
      id,
      sam,
      name,
      parentId,
      scope: input.scope,
      category: input.category ?? 'Security',
      members: [],
      description: input.description ?? '',
      builtin: false
    })
    return id
  })
}

/** Règles d'imbrication selon l'étendue des groupes. */
function memberAllowed(group: AdGroup, member: AdObject): string | null {
  if (member.kind !== 'group') return null
  if (member.obj.id === group.id) return 'Un groupe ne peut pas être membre de lui-même.'
  if (member.obj.scope === 'DomainLocal' && group.scope !== 'DomainLocal')
    return `Le groupe de domaine local « ${member.obj.name} » ne peut pas être membre du groupe ${group.scope === 'Global' ? 'global' : 'universel'} « ${group.name} ».`
  if (member.obj.scope === 'Universal' && group.scope === 'Global')
    return `Le groupe universel « ${member.obj.name} » ne peut pas être membre du groupe global « ${group.name} ».`
  return null
}

export function addGroupMembers(
  state: LabState,
  domainName: string,
  groupIdentity: string,
  members: string[]
): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const group = findPrincipal(domain as Domain, groupIdentity)
    if (!group || group.kind !== 'group') notFound(domain as Domain, groupIdentity)
    const target = domain.groups.find((g) => g.id === group.obj.id) as Draft<AdGroup>
    for (const m of members) {
      const member = findPrincipal(domain as Domain, m)
      if (!member) notFound(domain as Domain, m)
      const err = memberAllowed(target as AdGroup, member)
      if (err) raise('InvalidMember', err)
      if (!target.members.includes(member.obj.id)) target.members.push(member.obj.id)
    }
    return undefined
  })
}

export function removeGroupMembers(
  state: LabState,
  domainName: string,
  groupIdentity: string,
  members: string[]
): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const group = findPrincipal(domain as Domain, groupIdentity)
    if (!group || group.kind !== 'group') notFound(domain as Domain, groupIdentity)
    const target = domain.groups.find((g) => g.id === group.obj.id) as Draft<AdGroup>
    for (const m of members) {
      const member = findPrincipal(domain as Domain, m)
      if (!member) notFound(domain as Domain, m)
      if (!target.members.includes(member.obj.id))
        raise('NotMember', `« ${member.obj.name} » n’est pas membre du groupe « ${target.name} ».`)
      target.members = target.members.filter((id) => id !== member.obj.id)
    }
    return undefined
  })
}

export function setAccountEnabled(
  state: LabState,
  domainName: string,
  identity: string,
  enabled: boolean
): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const found = findPrincipal(domain as Domain, identity)
    if (!found || (found.kind !== 'user' && found.kind !== 'computer')) notFound(domain as Domain, identity)
    if (found.kind === 'user') {
      const user = domain.users.find((u) => u.id === found.obj.id)
      if (user && enabled && !user.password && domainPasswordPolicy(domain as Domain).minLength > 0)
        raise(
          'PasswordRequired',
          `${PASSWORD_POLICY_ERROR} Définissez d’abord un mot de passe pour ce compte.`
        )
      if (user) user.enabled = enabled
    } else {
      const c = domain.computers.find((x) => x.id === found.obj.id)
      if (c) c.enabled = enabled
    }
    return undefined
  })
}

export function resetPassword(
  state: LabState,
  domainName: string,
  identity: string,
  password: string,
  mustChange = false
): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const found = findPrincipal(domain as Domain, identity)
    if (!found || found.kind !== 'user') notFound(domain as Domain, identity)
    if (!passwordMeetsPolicy(password, found.obj.sam, domainPasswordPolicy(domain as Domain)))
      raise('PasswordPolicy', PASSWORD_POLICY_ERROR)
    const user = domain.users.find((u) => u.id === found.obj.id)
    if (user) {
      user.password = password
      user.mustChangePassword = mustChange
    }
    return undefined
  })
}

export function setUserProperties(
  state: LabState,
  domainName: string,
  identity: string,
  props: {
    description?: string
    givenName?: string
    surname?: string
    upn?: string
    mustChangePassword?: boolean
  }
): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const found = findPrincipal(domain as Domain, identity)
    if (!found || found.kind !== 'user') notFound(domain as Domain, identity)
    const user = domain.users.find((u) => u.id === found.obj.id)
    if (user)
      Object.assign(user, Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined)))
    return undefined
  })
}

/** Déplace un objet vers un autre conteneur (DN cible). */
export function moveObject(
  state: LabState,
  domainName: string,
  objectId: string,
  targetPath: string
): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const target = resolveContainerDn(domain as Domain, targetPath)
    if (target === undefined)
      raise('DirectoryObjectNotFound', `Objet de répertoire non trouvé : « ${targetPath} ».`)
    const found = objectById(domain as Domain, objectId)
    if (!found) raise('NotFound', 'Objet introuvable.')
    if (found.kind === 'container') {
      // Interdit de déplacer une OU dans sa propre descendance
      let cursor: string | null = target
      while (cursor) {
        if (cursor === objectId)
          raise(
            'InvalidMove',
            'Impossible de déplacer une unité d’organisation dans l’une de ses sous-unités.'
          )
        cursor = domain.containers.find((c) => c.id === cursor)?.parentId ?? null
      }
      if (found.obj.builtin) raise('Builtin', 'Les conteneurs intégrés ne peuvent pas être déplacés.')
    } else if (target === null)
      raise('InvalidPath', 'Seules les unités d’organisation peuvent se trouver à la racine du domaine.')
    assertNameAvailable(domain, target, found.obj.name)
    const list =
      found.kind === 'container'
        ? domain.containers
        : found.kind === 'user'
          ? domain.users
          : found.kind === 'group'
            ? domain.groups
            : domain.computers
    const item = (list as { id: string; parentId: string | null }[]).find((x) => x.id === objectId)
    if (item) item.parentId = target
    return undefined
  })
}

/** Supprime un objet (OU vide ou récursivement, protection contre la suppression accidentelle). */
export function removeObject(
  state: LabState,
  domainName: string,
  objectId: string,
  recursive = false
): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const found = objectById(domain as Domain, objectId)
    if (!found) raise('NotFound', 'Objet introuvable.')
    if (found.kind !== 'computer' && found.obj.builtin)
      raise('Builtin', `L’objet intégré « ${found.obj.name} » ne peut pas être supprimé.`)
    if (found.kind === 'container' && found.obj.protected)
      raise(
        'AccessDenied',
        `Vous ne disposez pas des privilèges suffisants pour supprimer « ${found.obj.name} », ou cet objet est protégé contre les suppressions accidentelles.`
      )
    const toDelete = new Set([objectId])
    if (found.kind === 'container') {
      let changed = true
      while (changed) {
        changed = false
        for (const o of [...domain.containers, ...domain.users, ...domain.groups, ...domain.computers]) {
          if (o.parentId && toDelete.has(o.parentId) && !toDelete.has(o.id)) {
            toDelete.add(o.id)
            changed = true
          }
        }
      }
      if (toDelete.size > 1 && !recursive)
        raise(
          'NotEmpty',
          `L’unité d’organisation « ${found.obj.name} » contient des objets : utilisez -Recursive pour la supprimer avec son contenu.`
        )
      if (domain.containers.some((c) => toDelete.has(c.id) && c.protected && c.id !== objectId))
        raise(
          'AccessDenied',
          'Une sous-unité d’organisation est protégée contre les suppressions accidentelles.'
        )
    }
    domain.containers = domain.containers.filter((c) => !toDelete.has(c.id))
    domain.users = domain.users.filter((u) => !toDelete.has(u.id))
    domain.groups = domain.groups.filter((g) => !toDelete.has(g.id))
    domain.computers = domain.computers.filter((c) => !toDelete.has(c.id))
    for (const g of domain.groups) g.members = g.members.filter((m) => !toDelete.has(m))
    return undefined
  })
}

/** Modifie la protection contre la suppression accidentelle d'une OU. */
export function setOuProtection(
  state: LabState,
  domainName: string,
  ouId: string,
  protectedFromDeletion: boolean
): EngineResult {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const ou = domain.containers.find((c) => c.id === ouId && c.kind === 'ou')
    if (!ou) raise('NotFound', 'Unité d’organisation introuvable.')
    ou.protected = protectedFromDeletion
    return undefined
  })
}
