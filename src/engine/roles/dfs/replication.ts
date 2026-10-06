/**
 * Réplication DFS : groupes de réplication, dossiers répliqués et synchronisation des membres.
 *
 * La synchronisation compare le contenu de chaque membre à l'état de la dernière réplication
 * (instantané) : un élément absent d'un membre mais connu a été supprimé (suppression propagée),
 * un élément inconnu a été ajouté (copié partout), un fichier modifié est recopié (la version la plus
 * récente l'emporte). La première réplication fait autorité depuis le membre principal. Elle est
 * effectuée par une tâche de fond (après chaque modification en Temps réel, différée en Simulation)
 * ou à la demande (Sync-DfsReplicationGroup).
 */
import type { Draft } from 'immer'
import { raise, transact, type EngineResult } from '../../core/result'
import type { FsNode, LabState, ServerDevice, Storage } from '../../model/schema'
import { effectiveIpv4 } from '../../net/addressing'
import { requireDevice } from '../../topology/actions'
import { serverExchange } from '../adds/locator'
import { ensureLocalPath } from '../files/actions'
import { findNode } from '../files/paths'
import { ensureRoleState } from '../state'
import type { ReplicaEntry, ReplicatedFolder, ReplicationGroup } from './schema'
import { DFS_STATE, dfsOf } from './state'

/** Port de la réplication DFS (RPC sur TCP). */
export const DFSR_PORT = 5722

function requireReplicationServer(draft: Draft<LabState>, deviceId: string): Draft<ServerDevice> {
  const server = requireDevice(draft, deviceId)
  if (server.kind !== 'server' || !server.host.features.includes('FS-DFS-Replication'))
    raise('DfsrNotInstalled', `Le service Réplication DFS n’est pas installé sur ${server.name}.`)
  return server
}

function serverByName(draft: Draft<LabState>, name: string): Draft<ServerDevice> {
  const lower = name.trim().split('.')[0]?.toLowerCase()
  const server = Object.values(draft.devices).find(
    (d): d is Draft<ServerDevice> => d.kind === 'server' && d.name.toLowerCase() === lower
  )
  if (!server) raise('ServerNotFound', `L’ordinateur « ${name} » est introuvable.`)
  return requireReplicationServer(draft, server.id)
}

/** Groupe de réplication (où qu'il ait été créé), avec le serveur qui le conserve. */
export function findGroup(
  state: LabState,
  name: string
): { ownerId: string; group: ReplicationGroup } | null {
  const lower = name.trim().toLowerCase()
  for (const d of Object.values(state.devices)) {
    const group =
      d.kind === 'server' ? dfsOf(d)?.groups.find((g) => g.name.toLowerCase() === lower) : undefined
    if (group) return { ownerId: d.id, group }
  }
  return null
}

function groupDraft(draft: Draft<LabState>, name: string): Draft<ReplicationGroup> {
  const found = findGroup(draft as LabState, name)
  if (!found) raise('GroupNotFound', `Le groupe de réplication « ${name} » est introuvable.`)
  const owner = draft.devices[found.ownerId] as Draft<ServerDevice>
  return ensureRoleState(owner, DFS_STATE).groups.find((g) => g.name === found.group.name)!
}

export function newReplicationGroup(state: LabState, serverId: string, name: string): EngineResult {
  return transact(state, (draft) => {
    const server = requireReplicationServer(draft, serverId)
    const clean = name.trim()
    if (!clean) raise('InvalidName', 'Indiquez le nom du groupe de réplication.')
    if (findGroup(draft as LabState, clean))
      raise('GroupExists', `Le groupe de réplication « ${clean} » existe déjà.`)
    ensureRoleState(server, DFS_STATE).groups.push({ name: clean, members: [], folders: [] })
    return undefined
  })
}

export function removeReplicationGroup(state: LabState, name: string): EngineResult {
  return transact(state, (draft) => {
    const found = findGroup(draft as LabState, name)
    if (!found) raise('GroupNotFound', `Le groupe de réplication « ${name} » est introuvable.`)
    const dfs = ensureRoleState(draft.devices[found.ownerId] as Draft<ServerDevice>, DFS_STATE)
    dfs.groups = dfs.groups.filter((g) => g.name !== found.group.name)
    return undefined
  })
}

export function addReplicationMember(state: LabState, groupName: string, computer: string): EngineResult {
  return transact(state, (draft) => {
    const group = groupDraft(draft, groupName)
    const server = serverByName(draft, computer)
    if (group.members.includes(server.id)) raise('MemberExists', `${server.name} est déjà membre du groupe.`)
    group.members.push(server.id)
    return undefined
  })
}

export function newReplicatedFolder(state: LabState, groupName: string, folderName: string): EngineResult {
  return transact(state, (draft) => {
    const group = groupDraft(draft, groupName)
    const name = folderName.trim()
    if (!name) raise('InvalidName', 'Indiquez le nom du dossier répliqué.')
    if (group.folders.some((f) => f.name.toLowerCase() === name.toLowerCase()))
      raise('FolderExists', `Le dossier répliqué « ${name} » existe déjà.`)
    group.folders.push({ name, paths: {}, primary: null, snapshot: [], synced: {}, lastSync: null })
    return undefined
  })
}

/** Chemin local d'un membre pour un dossier répliqué (créé au besoin) ; membre principal facultatif. */
export function setMembership(
  state: LabState,
  groupName: string,
  folderName: string,
  computer: string,
  input: { contentPath: string; primary?: boolean }
): EngineResult {
  return transact(state, (draft) => {
    const group = groupDraft(draft, groupName)
    const folder = group.folders.find((f) => f.name.toLowerCase() === folderName.trim().toLowerCase())
    if (!folder) raise('FolderNotFound', `Le dossier répliqué « ${folderName} » est introuvable.`)
    const server = serverByName(draft, computer)
    if (!group.members.includes(server.id))
      raise('NotMember', `${server.name} n’est pas membre du groupe de réplication « ${group.name} ».`)
    const path = input.contentPath.trim().replace(/\\+$/, '')
    if (!/^[a-z]:\\.+/i.test(path))
      raise('InvalidPath', `Le chemin « ${input.contentPath} » n’est pas valide.`)
    ensureLocalPath(draft, server, path, 'folder')
    folder.paths[server.id] = path
    if (input.primary) folder.primary = server.id
    return undefined
  })
}

// ---------------------------------------------------------------------------
// Synchronisation
// ---------------------------------------------------------------------------

interface Item {
  path: string
  node: Draft<FsNode>
}

/** Contenu d'un dossier répliqué sur un membre : chemin relatif (minuscules) → élément. */
function contentOf(storage: Draft<Storage>, rootId: string): Map<string, Item> {
  const items = new Map<string, Item>()
  const walk = (parentId: string, prefix: string) => {
    for (const node of storage.nodes) {
      if (node.parentId !== parentId) continue
      const path = prefix ? `${prefix}\\${node.name}` : node.name
      items.set(path.toLowerCase(), { path, node })
      if (node.kind === 'folder') walk(node.id, path)
    }
  }
  walk(rootId, '')
  return items
}

function removeTree(storage: Draft<Storage>, id: string): void {
  const ids = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const n of storage.nodes)
      if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
        ids.add(n.id)
        grew = true
      }
  }
  storage.nodes = storage.nodes.filter((n) => !ids.has(n.id))
  storage.shares = storage.shares.filter((s) => !ids.has(s.folderId))
}

/** Membres joignables entre eux (à partir du premier membre en ligne) : connexion RPC tracée. */
function reachableMembers(state: LabState, ids: string[]): string[] {
  const online = ids.filter((id) => state.devices[id]?.powered)
  const [hub, ...others] = online
  if (!hub) return []
  const ipOf = (id: string) =>
    state.devices[id]?.interfaces.map((i) => effectiveIpv4(i)?.address).find((a) => !!a) ?? null
  return [
    hub,
    ...others.filter((id) => {
      const ip = ipOf(id)
      return (
        !!ip &&
        serverExchange(state, hub, ip, {
          protocol: 'SMB',
          port: DFSR_PORT,
          request: 'Réplication DFS : demande de mise à jour',
          reply: 'Réplication DFS : mise à jour',
          fields: []
        }).ok
      )
    })
  ]
}

/** Synchronise un dossier répliqué (brouillon) ; renvoie vrai si un membre a changé. */
function syncFolder(draft: Draft<LabState>, folder: Draft<ReplicatedFolder>, memberIds: string[]): boolean {
  const members = memberIds
    .map((id) => {
      const server = draft.devices[id] as Draft<ServerDevice> | undefined
      const path = folder.paths[id]
      const root = server && path ? findNode(server.storage as Storage, path) : undefined
      return server && path && root
        ? { server, path, rootId: root.id, items: contentOf(server.storage, root.id) }
        : null
    })
    .filter((m): m is NonNullable<typeof m> => m !== null)
  if (members.length < 2) return false
  const known = new Map(folder.snapshot.map((e) => [e.path.toLowerCase(), e]))
  const primary = members.find((m) => m.server.id === folder.primary) ?? members[0]!
  const initial = folder.lastSync === null

  // Élément retenu par chemin : suppressions connues écartées, sinon la version la plus récente
  const result = new Map<string, ReplicaEntry>()
  const deleted = new Set<string>()
  const keys = new Set(members.flatMap((m) => [...m.items.keys()]))
  // Supprimé : présent sur un membre lors de sa dernière réplication, absent aujourd'hui
  for (const m of members)
    for (const key of folder.synced[m.server.id] ?? [])
      if (known.has(key) && !m.items.has(key)) deleted.add(key)
  for (const key of keys) {
    if (deleted.has(key)) continue
    const versions = members.flatMap((m) => {
      const item = m.items.get(key)
      return item ? [{ member: m, item }] : []
    })
    const best = versions.reduce((a, b) => {
      if (initial) return a.member === primary ? a : b.member === primary ? b : a
      return b.item.node.modifiedAt > a.item.node.modifiedAt ? b : a
    })
    result.set(key, {
      path: best.item.path,
      kind: best.item.node.kind,
      size: best.item.node.size,
      modifiedAt: best.item.node.modifiedAt
    })
  }

  let changed = false
  for (const m of members) {
    // Suppressions (dossiers parents d'abord, sous-éléments inclus)
    for (const key of [...deleted].sort((a, b) => a.length - b.length)) {
      const item = m.items.get(key)
      if (item && m.server.storage.nodes.some((n) => n.id === item.node.id)) {
        removeTree(m.server.storage, item.node.id)
        changed = true
      }
    }
    // Ajouts et mises à jour (chemins courts d'abord : dossiers parents créés avant)
    for (const entry of [...result.values()].sort((a, b) => a.path.length - b.path.length)) {
      const item = m.items.get(entry.path.toLowerCase())
      if (!item) {
        ensureLocalPath(draft, m.server, `${m.path}\\${entry.path}`, entry.kind, entry.size)
        const node = findNode(m.server.storage as Storage, `${m.path}\\${entry.path}`)
        if (node) {
          const created = m.server.storage.nodes.find((n) => n.id === node.id)!
          created.modifiedAt = entry.modifiedAt
        }
        changed = true
      } else if (
        entry.kind === 'file' &&
        (item.node.size !== entry.size || item.node.modifiedAt !== entry.modifiedAt)
      ) {
        item.node.size = entry.size
        item.node.modifiedAt = entry.modifiedAt
        changed = true
      }
    }
  }
  const snapshot = [...result.values()].sort((a, b) => a.path.localeCompare(b.path))
  const keysAfter = snapshot.map((e) => e.path.toLowerCase())
  const syncedChanged = members.some(
    (m) => JSON.stringify(folder.synced[m.server.id] ?? null) !== JSON.stringify(keysAfter)
  )
  if (changed || initial || syncedChanged || JSON.stringify(snapshot) !== JSON.stringify(folder.snapshot)) {
    folder.snapshot = snapshot
    for (const m of members) folder.synced[m.server.id] = keysAfter
    folder.lastSync = draft.clock
    return true
  }
  return false
}

/** Réplique tous les groupes (tâche de fond). */
export function replicateAll(state: LabState): { state: LabState; traces: [] } {
  const r = transact(state, (draft) => {
    for (const d of Object.values(draft.devices)) {
      if (d.kind !== 'server' || !d.roles['dfs']) continue
      const dfs = ensureRoleState(d, DFS_STATE)
      for (const group of dfs.groups) {
        const reachable = reachableMembers(draft as LabState, group.members)
        for (const folder of group.folders) syncFolder(draft, folder, reachable)
      }
    }
    return undefined
  })
  return { state: r.ok ? r.state : state, traces: [] }
}

/** Réplication immédiate d'un groupe (Sync-DfsReplicationGroup, « Répliquer maintenant »). */
export function syncReplicationGroup(state: LabState, groupName: string): EngineResult {
  return transact(state, (draft) => {
    const group = groupDraft(draft, groupName)
    const reachable = reachableMembers(draft as LabState, group.members)
    for (const folder of group.folders) syncFolder(draft, folder, reachable)
    return undefined
  })
}
