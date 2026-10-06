/**
 * Espaces de noms DFS de domaine : racine \\<domaine>\<nom> hébergée par un serveur d'espace de
 * noms (dossier C:\DFSRoots\<nom> partagé), dossiers et cibles ; référence des chemins réseau.
 */
import type { Draft } from 'immer'
import { raise, transact, type EngineResult } from '../../core/result'
import type { LabState, ServerDevice, Storage } from '../../model/schema'
import { requireDevice } from '../../topology/actions'
import { localToken } from '../files/acl'
import { createItem, createShare, ensureLocalPath, findShare } from '../files/actions'
import { findNode, nodePath, parseUnc } from '../files/paths'
import { ensureRoleState } from '../state'
import { DFS_STATE, findNamespace } from './state'

const NAME = /^[^\\/:*?"<>|]{1,80}$/

function requireNamespaceServer(draft: Draft<LabState>, deviceId: string): Draft<ServerDevice> {
  const server = requireDevice(draft, deviceId)
  if (server.kind !== 'server' || !server.host.features.includes('FS-DFS-Namespace'))
    raise('DfsNotInstalled', 'Le service Espaces de noms DFS n’est pas installé sur cet ordinateur.')
  if (!server.host.domain)
    raise(
      'NotDomainMember',
      'Un espace de noms de domaine exige un serveur membre d’un domaine Active Directory.'
    )
  return server
}

/** Chemin d'espace de noms \\domaine\racine[\dossier] décomposé. */
function parseNamespacePath(path: string): { domain: string; root: string; folder: string | null } {
  const unc = parseUnc(path)
  if (!unc || !unc.share || unc.rest.length > 1)
    raise(
      'InvalidPath',
      `Le chemin « ${path} » n’est pas un chemin d’espace de noms (\\\\domaine\\racine\\dossier).`
    )
  return { domain: unc.server, root: unc.share, folder: unc.rest[0] ?? null }
}

/** La cible \\serveur\partage existe-t-elle ? */
function requireTarget(state: LabState, target: string): string {
  const unc = parseUnc(target)
  if (!unc || !unc.share || unc.rest.length > 0)
    raise('InvalidPath', `La cible « ${target} » n’est pas un chemin \\\\serveur\\partage.`)
  const server = Object.values(state.devices).find(
    (d): d is ServerDevice =>
      d.kind === 'server' && d.name.toLowerCase() === unc.server.split('.')[0]?.toLowerCase()
  )
  if (!server || !findShare(server, unc.share))
    raise('TargetNotFound', `Le chemin d’accès réseau \\\\${unc.server}\\${unc.share} est introuvable.`)
  return `\\\\${server.name}\\${unc.share}`
}

/**
 * Nouvel espace de noms de domaine. `createShare` (assistant de la console) : crée le dossier
 * C:\DFSRoots\<nom> et son partage ; sinon (New-DfsnRoot) le partage doit exister.
 */
export function newNamespace(
  state: LabState,
  serverId: string,
  input: { name: string; createShare?: boolean }
): EngineResult<string> {
  const name = input.name.trim()
  const check = transact(state, (draft) => {
    const server = requireNamespaceServer(draft, serverId)
    if (!NAME.test(name)) raise('InvalidName', `Le nom « ${input.name} » n’est pas valide.`)
    if (findNamespace(draft as LabState, server.host.domain ?? '', name))
      raise('NamespaceExists', `L’espace de noms \\\\${server.host.domain}\\${name} existe déjà.`)
    return server.name
  })
  if (!check.ok) return check
  let s = state
  const rootPath = `C:\\DFSRoots\\${name}`
  if (input.createShare) {
    const admin = localToken(check.value, 'Administrateur')
    const folder = createItem(s, serverId, rootPath, 'folder', admin, { parents: true })
    if (!folder.ok && folder.error.code !== 'ItemExists') return folder
    if (folder.ok) s = folder.state
    const share = createShare(s, serverId, { name, path: rootPath, read: ['Tout le monde'] }, admin)
    if (!share.ok) return share
    s = share.state
  }
  return transact(s, (draft) => {
    const server = requireNamespaceServer(draft, serverId)
    const share = findShare(server as ServerDevice, name)
    if (!share)
      raise(
        'ShareNotFound',
        `Le partage \\\\${server.name}\\${name} n’existe pas : créez-le avant la racine de l’espace de noms.`
      )
    const dfs = ensureRoleState(server, DFS_STATE)
    // Dossier racine : celui du partage (créé par l'assistant ou existant)
    dfs.namespaces.push({ name, rootPath: nodePath(server.storage as Storage, share.folderId), folders: [] })
    return `\\\\${server.host.domain}\\${name}`
  })
}

export function removeNamespace(state: LabState, serverId: string, name: string): EngineResult {
  return transact(state, (draft) => {
    const server = requireNamespaceServer(draft, serverId)
    const dfs = ensureRoleState(server, DFS_STATE)
    const before = dfs.namespaces.length
    dfs.namespaces = dfs.namespaces.filter((n) => n.name.toLowerCase() !== name.trim().toLowerCase())
    if (dfs.namespaces.length === before)
      raise('NamespaceNotFound', `L’espace de noms « ${name} » est introuvable.`)
    return undefined
  })
}

/** Espace de noms (brouillon) désigné par un chemin, avec son serveur. */
function namespaceAt(draft: Draft<LabState>, path: string) {
  const parsed = parseNamespacePath(path)
  const found = findNamespace(draft as LabState, parsed.domain, parsed.root)
  if (!found)
    raise('NamespaceNotFound', `L’espace de noms \\\\${parsed.domain}\\${parsed.root} est introuvable.`)
  const server = draft.devices[found.server.id] as Draft<ServerDevice>
  const namespace = ensureRoleState(server, DFS_STATE).namespaces.find(
    (n) => n.name === found.namespace.name
  )!
  return { server, namespace, folder: parsed.folder }
}

/** Nouveau dossier de l'espace de noms avec sa première cible. */
export function newNamespaceFolder(state: LabState, path: string, target: string): EngineResult {
  return transact(state, (draft) => {
    const { server, namespace, folder } = namespaceAt(draft, path)
    if (!folder || !NAME.test(folder)) raise('InvalidPath', `Indiquez le dossier : ${path}\\<dossier>.`)
    if (namespace.folders.some((f) => f.name.toLowerCase() === folder.toLowerCase()))
      raise('FolderExists', `Le dossier « ${folder} » existe déjà dans l’espace de noms.`)
    namespace.folders.push({ name: folder, targets: [requireTarget(draft as LabState, target)] })
    // Point d'analyse dans le dossier racine (visible en parcourant \\domaine\racine)
    ensureLocalPath(draft, server, `${namespace.rootPath}\\${folder}`, 'folder')
    return undefined
  })
}

export function addFolderTarget(state: LabState, path: string, target: string): EngineResult {
  return transact(state, (draft) => {
    const { namespace, folder } = namespaceAt(draft, path)
    const entry = namespace.folders.find((f) => f.name.toLowerCase() === (folder ?? '').toLowerCase())
    if (!entry) raise('FolderNotFound', `Le dossier d’espace de noms « ${path} » est introuvable.`)
    const unc = requireTarget(draft as LabState, target)
    if (entry.targets.some((t) => t.toLowerCase() === unc.toLowerCase()))
      raise('TargetExists', `La cible ${unc} existe déjà.`)
    entry.targets.push(unc)
    return undefined
  })
}

export function removeFolderTarget(state: LabState, path: string, target: string): EngineResult {
  return transact(state, (draft) => {
    const { namespace, folder } = namespaceAt(draft, path)
    const entry = namespace.folders.find((f) => f.name.toLowerCase() === (folder ?? '').toLowerCase())
    if (!entry) raise('FolderNotFound', `Le dossier d’espace de noms « ${path} » est introuvable.`)
    const before = entry.targets.length
    entry.targets = entry.targets.filter((t) => t.toLowerCase() !== target.trim().toLowerCase())
    if (entry.targets.length === before) raise('TargetNotFound', `La cible ${target} est introuvable.`)
    return undefined
  })
}

export function removeNamespaceFolder(state: LabState, path: string): EngineResult {
  return transact(state, (draft) => {
    const { server, namespace, folder } = namespaceAt(draft, path)
    const before = namespace.folders.length
    namespace.folders = namespace.folders.filter((f) => f.name.toLowerCase() !== (folder ?? '').toLowerCase())
    if (namespace.folders.length === before)
      raise('FolderNotFound', `Le dossier d’espace de noms « ${path} » est introuvable.`)
    const node = findNode(server.storage, `${namespace.rootPath}\\${folder}`)
    if (node) server.storage.nodes = server.storage.nodes.filter((n) => n.id !== node.id)
    return undefined
  })
}

/**
 * Référence DFS : \\lab.local\Partages\Compta\Budget → première cible en ligne du dossier
 * (\\SRV1\Compta\Budget) ; \\lab.local\Partages → partage racine du serveur d'espace de noms.
 */
export function resolveDfsPath(state: LabState, _clientId: string, path: string): string | null {
  const unc = parseUnc(path)
  if (!unc || !unc.share) return null
  const found = findNamespace(state, unc.server, unc.share)
  if (!found) return null
  const [first, ...rest] = unc.rest
  const folder = first
    ? found.namespace.folders.find((f) => f.name.toLowerCase() === first.toLowerCase())
    : undefined
  if (!folder)
    return `\\\\${found.server.name}\\${found.namespace.name}${unc.rest.map((p) => `\\${p}`).join('')}`
  const online = folder.targets.find((t) => {
    const name = parseUnc(t)?.server.toLowerCase()
    return Object.values(state.devices).some(
      (d) => d.kind === 'server' && d.powered && d.name.toLowerCase() === name
    )
  })
  const target = online ?? folder.targets[0]
  return target ? `${target}${rest.map((p) => `\\${p}`).join('')}` : null
}
