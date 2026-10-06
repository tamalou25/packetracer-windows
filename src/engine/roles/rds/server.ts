/**
 * Bureau à distance : paramètre « Autoriser les connexions à distance » et groupe Utilisateurs du
 * Bureau à distance de chaque ordinateur ; collections de sessions et programmes RemoteApp de
 * l'hôte de session (rôle RDS).
 */
import type { Draft } from 'immer'
import { raise, transact, type EngineResult } from '../../core/result'
import type { Domain, HostDevice, LabState, ServerDevice } from '../../model/schema'
import { requireDevice } from '../../topology/actions'
import { AD_GROUPS, findPrincipal } from '../adds/directory'
import { ensureRoleState } from '../state'
import type { RdsServer, RemoteApp } from './schema'
import { RDS_STATE } from './state'

function requireHost(draft: Draft<LabState>, deviceId: string): Draft<HostDevice> {
  const device = requireDevice(draft, deviceId)
  if (device.kind !== 'server' && device.kind !== 'client')
    raise('NotSupported', 'Le Bureau à distance n’est disponible que sur un serveur ou un poste.')
  return device
}

export function requireRds(
  draft: Draft<LabState>,
  deviceId: string
): { device: Draft<ServerDevice>; rds: Draft<RdsServer> } {
  const device = requireDevice(draft, deviceId)
  if (device.kind !== 'server' || !device.host.features.includes('RDS-RD-Server'))
    raise(
      'RdsNotInstalled',
      'Le rôle Hôte de session Bureau à distance n’est pas installé sur cet ordinateur.'
    )
  return { device, rds: ensureRoleState(device, RDS_STATE) }
}

/** Domaine dont l'ordinateur est membre (comptes et groupes autorisés). */
function domainOf(draft: Draft<LabState>, host: Draft<HostDevice>): Draft<Domain> {
  const domain = host.host.domain ? draft.domains[host.host.domain] : undefined
  if (!domain)
    raise(
      'NotDomainMember',
      `${host.name} n’est pas membre d’un domaine : seuls des comptes du domaine peuvent être ajoutés.`
    )
  return domain
}

/** « LAB\GG_Compta » (compte ou groupe du domaine de l'ordinateur). */
function canonicalPrincipal(domain: Draft<Domain>, name: string): string {
  const principal = findPrincipal(domain as Domain, name)
  if (!principal || (principal.kind !== 'user' && principal.kind !== 'group'))
    raise(
      'UnknownAccount',
      `Le nom « ${name} » est introuvable dans le domaine ${domain.name} : vérifiez l’orthographe du compte ou du groupe.`
    )
  return `${domain.netbios}\\${principal.obj.sam}`
}

/** Autorise ou interdit les connexions Bureau à distance ; membres du groupe Utilisateurs du Bureau à distance. */
export function setRemoteDesktop(
  state: LabState,
  deviceId: string,
  settings: { enabled?: boolean; users?: string[] }
): EngineResult {
  return transact(state, (draft) => {
    const host = requireHost(draft, deviceId)
    if (settings.enabled !== undefined) host.host.remoteDesktop.enabled = settings.enabled
    if (settings.users) {
      const domain = settings.users.length > 0 ? domainOf(draft, host) : null
      const users = settings.users.map((u) => canonicalPrincipal(domain as Draft<Domain>, u))
      host.host.remoteDesktop.users = [...new Set(users)]
    }
    return undefined
  })
}

export interface CollectionInput {
  name: string
  description?: string
  userGroups: string[]
}

/** Nouvelle collection de sessions sur l'hôte de session (Bureau à distance activé). */
export function addSessionCollection(
  state: LabState,
  deviceId: string,
  input: CollectionInput
): EngineResult {
  return transact(state, (draft) => {
    const { device, rds } = requireRds(draft, deviceId)
    const name = input.name.trim()
    if (!name) raise('InvalidName', 'Indiquez le nom de la collection.')
    if (rds.collections.some((c) => c.name.toLowerCase() === name.toLowerCase()))
      raise('CollectionExists', `La collection « ${name} » existe déjà.`)
    const domain = domainOf(draft, device)
    // Par défaut, comme l'assistant : Utilisateurs du domaine
    const requested = input.userGroups.length > 0 ? input.userGroups : [AD_GROUPS.domainUsers]
    const groups = requested.map((g) => canonicalPrincipal(domain, g))
    rds.collections.push({ name, description: input.description ?? '', userGroups: groups, remoteApps: [] })
    device.host.remoteDesktop.enabled = true
    return undefined
  })
}

function findCollection(rds: Draft<RdsServer>, name: string) {
  const collection = rds.collections.find((c) => c.name.toLowerCase() === name.trim().toLowerCase())
  if (!collection) raise('CollectionNotFound', `La collection « ${name} » est introuvable.`)
  return collection
}

export function removeSessionCollection(state: LabState, deviceId: string, name: string): EngineResult {
  return transact(state, (draft) => {
    const { rds } = requireRds(draft, deviceId)
    const collection = findCollection(rds, name)
    rds.collections = rds.collections.filter((c) => c !== collection)
    return undefined
  })
}

export function setCollectionUserGroups(
  state: LabState,
  deviceId: string,
  name: string,
  userGroups: string[]
): EngineResult {
  return transact(state, (draft) => {
    const { device, rds } = requireRds(draft, deviceId)
    const collection = findCollection(rds, name)
    const domain = domainOf(draft, device)
    const groups = userGroups.map((g) => canonicalPrincipal(domain, g))
    if (groups.length === 0) raise('InvalidArgument', 'Indiquez au moins un groupe d’utilisateurs.')
    collection.userGroups = [...new Set(groups)]
    return undefined
  })
}

/** Publie un programme RemoteApp dans une collection. */
export function addRemoteApp(
  state: LabState,
  deviceId: string,
  collectionName: string,
  app: { displayName: string; filePath: string; alias?: string }
): EngineResult<string> {
  return transact(state, (draft) => {
    const { rds } = requireRds(draft, deviceId)
    const collection = findCollection(rds, collectionName)
    const displayName = app.displayName.trim()
    if (!displayName) raise('InvalidName', 'Indiquez le nom du programme RemoteApp.')
    if (!/^[a-z]:\\.+\.exe$/i.test(app.filePath.trim()))
      raise(
        'InvalidPath',
        `Le chemin « ${app.filePath} » n’est pas celui d’un programme (C:\\…\\programme.exe).`
      )
    const alias = (
      app.alias?.trim() ||
      app.filePath
        .trim()
        .split('\\')
        .pop()!
        .replace(/\.exe$/i, '')
    ).toLowerCase()
    if (collection.remoteApps.some((a) => a.alias === alias))
      raise('RemoteAppExists', `Un programme RemoteApp d’alias « ${alias} » est déjà publié.`)
    const entry: RemoteApp = { alias, displayName, filePath: app.filePath.trim() }
    collection.remoteApps.push(entry)
    return alias
  })
}

export function removeRemoteApp(
  state: LabState,
  deviceId: string,
  collectionName: string,
  alias: string
): EngineResult {
  return transact(state, (draft) => {
    const { rds } = requireRds(draft, deviceId)
    const collection = findCollection(rds, collectionName)
    const before = collection.remoteApps.length
    collection.remoteApps = collection.remoteApps.filter((a) => a.alias !== alias.toLowerCase())
    if (collection.remoteApps.length === before)
      raise('RemoteAppNotFound', `Le programme RemoteApp « ${alias} » est introuvable.`)
    return undefined
  })
}
