/**
 * Annuaire Active Directory : noms distinctifs (DN), recherche d'objets, appartenance aux
 * groupes, stratégie de mot de passe et objets créés avec un nouveau domaine.
 */
import type { Draft } from 'immer'
import { raise } from '../../core/result'
import { nextSeq } from '../../model/factory'
import type { AdComputer, AdContainer, AdGroup, AdUser, Domain, LabState } from '../../model/schema'

export type AdObject =
  | { kind: 'container'; obj: AdContainer }
  | { kind: 'user'; obj: AdUser }
  | { kind: 'group'; obj: AdGroup }
  | { kind: 'computer'; obj: AdComputer }

/** Noms des groupes intégrés (français). */
export const AD_GROUPS = {
  domainAdmins: 'Admins du domaine',
  domainUsers: 'Utilisateurs du domaine',
  domainComputers: 'Ordinateurs du domaine',
  domainControllers: 'Contrôleurs de domaine',
  enterpriseAdmins: 'Administrateurs de l’entreprise',
  schemaAdmins: 'Admins du schéma',
  gpoCreators: 'Propriétaires créateurs de la stratégie de groupe',
  domainGuests: 'Invités du domaine',
  administrators: 'Administrateurs',
  users: 'Utilisateurs',
  guests: 'Invités'
} as const

/** « DC=lab,DC=local ». */
export function domainDn(domain: Pick<Domain, 'name'>): string {
  return domain.name
    .split('.')
    .map((p) => `DC=${p}`)
    .join(',')
}

export function findContainer(domain: Domain, id: string | null): AdContainer | undefined {
  return id === null ? undefined : domain.containers.find((c) => c.id === id)
}

/** DN d'un conteneur (null = racine du domaine). */
export function containerDn(domain: Domain, id: string | null): string {
  const parts: string[] = []
  let current = findContainer(domain, id)
  while (current) {
    parts.push(`${current.kind === 'ou' ? 'OU' : 'CN'}=${current.name}`)
    current = findContainer(domain, current.parentId)
  }
  parts.push(domainDn(domain))
  return parts.join(',')
}

export function objectDn(domain: Domain, object: AdObject): string {
  if (object.kind === 'container') return containerDn(domain, object.obj.id)
  return `CN=${object.obj.name},${containerDn(domain, object.obj.parentId)}`
}

export function allObjects(domain: Domain): AdObject[] {
  return [
    ...domain.containers.map((obj) => ({ kind: 'container' as const, obj })),
    ...domain.users.map((obj) => ({ kind: 'user' as const, obj })),
    ...domain.groups.map((obj) => ({ kind: 'group' as const, obj })),
    ...domain.computers.map((obj) => ({ kind: 'computer' as const, obj }))
  ]
}

export function objectById(domain: Domain, id: string): AdObject | undefined {
  return allObjects(domain).find((o) => o.obj.id === id)
}

/** Conteneur désigné par un DN (« OU=Compta,DC=lab,DC=local ») ; null = racine. */
export function resolveContainerDn(domain: Domain, dn: string): string | null | undefined {
  const parts = dn
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  const dcs = parts.filter((p) => /^dc=/i.test(p)).map((p) => p.slice(3).toLowerCase())
  if (dcs.join('.') !== domain.name) return undefined
  const path = parts.filter((p) => !/^dc=/i.test(p)).reverse()
  let parent: string | null = null
  for (const part of path) {
    const m = /^(ou|cn)=(.+)$/i.exec(part)
    if (!m) return undefined
    const kind = (m[1] as string).toLowerCase() === 'ou' ? 'ou' : 'container'
    const name = (m[2] as string).toLowerCase()
    const next = domain.containers.find(
      (c) => c.parentId === parent && c.kind === kind && c.name.toLowerCase() === name
    )
    if (!next) return undefined
    parent = next.id
  }
  return parent
}

/**
 * Objet désigné par une identité : sAMAccountName, nom, UPN ou DN
 * (utilisateurs, groupes, ordinateurs).
 */
export function findPrincipal(domain: Domain, identity: string): AdObject | undefined {
  const id = identity.trim().toLowerCase()
  const short = id.includes('\\') ? (id.split('\\')[1] ?? id) : id
  for (const o of allObjects(domain)) {
    if (o.kind === 'container') continue
    const sam = o.kind === 'computer' ? `${o.obj.name.toLowerCase()}$` : o.obj.sam.toLowerCase()
    if (
      sam === short ||
      o.obj.name.toLowerCase() === short ||
      (o.kind === 'computer' && o.obj.name.toLowerCase() === short.replace(/\$$/, '')) ||
      (o.kind === 'user' && o.obj.upn.toLowerCase() === id) ||
      objectDn(domain, o).toLowerCase() === id
    )
      return o
  }
  return undefined
}

export function findGroupByName(domain: Domain, name: string): AdGroup | undefined {
  return domain.groups.find(
    (g) => g.name.toLowerCase() === name.toLowerCase() || g.sam.toLowerCase() === name.toLowerCase()
  )
}

/** Groupes dont l'objet est membre (récursivement, y compris groupes imbriqués). */
export function groupsOf(domain: Domain, objectId: string): AdGroup[] {
  const result = new Map<string, AdGroup>()
  const queue = [objectId]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const g of domain.groups) {
      if (g.members.includes(current) && !result.has(g.id)) {
        result.set(g.id, g)
        queue.push(g.id)
      }
    }
  }
  return [...result.values()]
}

/** Vrai si le compte est administrateur du domaine (directement ou par imbrication). */
export function isDomainAdmin(domain: Domain, userSam: string): boolean {
  const user = domain.users.find((u) => u.sam.toLowerCase() === userSam.toLowerCase())
  if (!user) return false
  const names = groupsOf(domain, user.id).map((g) => g.name)
  return (
    names.includes(AD_GROUPS.domainAdmins) ||
    names.includes(AD_GROUPS.enterpriseAdmins) ||
    names.includes(AD_GROUPS.administrators)
  )
}

/** Domaine par nom DNS ou NetBIOS. */
export function findDomain(state: LabState, name: string): Domain | undefined {
  const lower = name.trim().toLowerCase()
  return Object.values(state.domains).find((d) => d.name === lower || d.netbios.toLowerCase() === lower)
}

export const PASSWORD_POLICY_ERROR =
  'Le mot de passe ne répond pas aux spécifications de longueur, de complexité ou d’historique du domaine.'

/** Stratégie de mot de passe par défaut : 7 caractères, 3 catégories sur 4, sans le nom du compte. */
export function passwordMeetsPolicy(password: string, sam = ''): boolean {
  if (password.length < 7) return false
  const categories = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length
  if (categories < 3) return false
  if (sam.length >= 3 && password.toLowerCase().includes(sam.toLowerCase())) return false
  return true
}

/** Identifiant unique d'objet d'annuaire. */
export function newAdId(draft: Draft<LabState>): string {
  return `ad${nextSeq(draft)}`
}

/** Vérifie qu'aucun compte n'utilise déjà ce sAMAccountName. */
export function assertSamAvailable(domain: Draft<Domain>, sam: string): void {
  const lower = sam.toLowerCase()
  const taken =
    domain.users.some((u) => u.sam.toLowerCase() === lower) ||
    domain.groups.some((g) => g.sam.toLowerCase() === lower) ||
    domain.computers.some((c) => `${c.name.toLowerCase()}$` === lower)
  if (taken) raise('AccountExists', 'Le compte spécifié existe déjà.')
}

/** Vérifie qu'aucun objet du conteneur ne porte déjà ce nom (CN unique par conteneur). */
export function assertNameAvailable(domain: Draft<Domain>, parentId: string | null, name: string): void {
  const lower = name.toLowerCase()
  const clash =
    domain.containers.some((c) => c.parentId === parentId && c.name.toLowerCase() === lower) ||
    domain.users.some((u) => u.parentId === parentId && u.name.toLowerCase() === lower) ||
    domain.groups.some((g) => g.parentId === parentId && g.name.toLowerCase() === lower) ||
    domain.computers.some((c) => c.parentId === parentId && c.name.toLowerCase() === lower)
  if (clash) raise('NameExists', `Un objet nommé « ${name} » existe déjà dans ce conteneur.`)
}

/** Construit un domaine neuf avec ses conteneurs, comptes et groupes intégrés. */
export function buildDomain(
  draft: Draft<LabState>,
  name: string,
  netbios: string,
  adminPassword: string,
  dc: { deviceId: string; name: string }
): Domain {
  const container = (cname: string, kind: 'ou' | 'container', description: string): AdContainer => ({
    id: newAdId(draft),
    name: cname,
    parentId: null,
    kind,
    description,
    protected: kind === 'ou',
    builtin: true
  })
  const builtin = container('Builtin', 'container', 'Conteneur des groupes intégrés')
  const computers = container('Computers', 'container', 'Conteneur par défaut des comptes d’ordinateurs')
  const users = container('Users', 'container', 'Conteneur par défaut des comptes d’utilisateurs')
  const dcs = container(
    'Domain Controllers',
    'ou',
    'Unité d’organisation par défaut des contrôleurs de domaine'
  )

  const user = (
    sam: string,
    cname: string,
    description: string,
    enabled: boolean,
    password = ''
  ): AdUser => ({
    id: newAdId(draft),
    sam,
    name: cname,
    givenName: '',
    surname: '',
    upn: '',
    parentId: users.id,
    password,
    enabled,
    mustChangePassword: false,
    description,
    builtin: true
  })
  const admin = user(
    'Administrateur',
    'Administrateur',
    'Compte d’utilisateur d’administration du domaine',
    true,
    adminPassword
  )
  const guest = user('Invité', 'Invité', 'Compte d’utilisateur invité', false)
  const krbtgt = user('krbtgt', 'krbtgt', 'Compte de service du centre de distribution de clés', false)

  const group = (
    gname: string,
    scope: AdGroup['scope'],
    parent: AdContainer,
    members: string[],
    description: string
  ): AdGroup => ({
    id: newAdId(draft),
    sam: gname,
    name: gname,
    parentId: parent.id,
    scope,
    category: 'Security',
    members,
    description,
    builtin: true
  })
  const domainAdmins = group(
    AD_GROUPS.domainAdmins,
    'Global',
    users,
    [admin.id],
    'Administrateurs désignés du domaine'
  )
  const domainUsers = group(
    AD_GROUPS.domainUsers,
    'Global',
    users,
    [admin.id, krbtgt.id],
    'Tous les utilisateurs du domaine'
  )
  const domainComputers = group(
    AD_GROUPS.domainComputers,
    'Global',
    users,
    [],
    'Toutes les stations de travail et tous les serveurs joints au domaine'
  )
  const dcComputer: AdComputer = {
    id: newAdId(draft),
    name: dc.name,
    parentId: dcs.id,
    deviceId: dc.deviceId,
    enabled: true,
    dnsHostName: `${dc.name.toLowerCase()}.${name}`
  }
  const domainControllers = group(
    AD_GROUPS.domainControllers,
    'Global',
    users,
    [dcComputer.id],
    'Tous les contrôleurs de domaine du domaine'
  )
  const enterpriseAdmins = group(
    AD_GROUPS.enterpriseAdmins,
    'Universal',
    users,
    [admin.id],
    'Administrateurs désignés de l’entreprise'
  )
  const schemaAdmins = group(
    AD_GROUPS.schemaAdmins,
    'Universal',
    users,
    [admin.id],
    'Administrateurs désignés du schéma'
  )
  const gpoCreators = group(
    AD_GROUPS.gpoCreators,
    'Global',
    users,
    [admin.id],
    'Les membres de ce groupe peuvent modifier la stratégie de groupe du domaine'
  )
  const domainGuests = group(
    AD_GROUPS.domainGuests,
    'Global',
    users,
    [guest.id],
    'Tous les invités du domaine'
  )
  const administrators = group(
    AD_GROUPS.administrators,
    'DomainLocal',
    builtin,
    [admin.id, domainAdmins.id, enterpriseAdmins.id],
    'Les administrateurs ont un accès complet et non restreint à l’ordinateur/au domaine'
  )
  const usersGroup = group(
    AD_GROUPS.users,
    'DomainLocal',
    builtin,
    [domainUsers.id],
    'Les utilisateurs ne peuvent pas effectuer de modifications accidentelles ou intentionnelles à l’échelle du système'
  )
  const guests = group(
    AD_GROUPS.guests,
    'DomainLocal',
    builtin,
    [guest.id, domainGuests.id],
    'Les invités ont un accès limité'
  )

  return {
    name,
    netbios,
    controllers: [dc.deviceId],
    containers: [builtin, computers, dcs, users],
    users: [admin, guest, krbtgt],
    groups: [
      domainAdmins,
      domainUsers,
      domainComputers,
      domainControllers,
      enterpriseAdmins,
      schemaAdmins,
      gpoCreators,
      domainGuests,
      administrators,
      usersGroup,
      guests
    ],
    computers: [dcComputer]
  }
}

/** Conteneur par défaut (CN=Users, CN=Computers). */
export function defaultContainer(domain: Domain, name: 'Users' | 'Computers'): string {
  const c = domain.containers.find((x) => x.parentId === null && x.kind === 'container' && x.name === name)
  return c?.id ?? ''
}
