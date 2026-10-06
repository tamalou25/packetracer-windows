/**
 * Sauvegarde Windows Server : stratégie planifiée, sauvegarde (unique ou selon la stratégie),
 * historique des versions et récupération de fichiers et dossiers.
 */
import type { Draft } from 'immer'
import { formatShortDate } from '../../core/clock'
import { logEvent } from '../../core/eventlog'
import { raise, transact, type EngineResult } from '../../core/result'
import type { LabState, ServerDevice, Storage } from '../../model/schema'
import { requireDevice } from '../../topology/actions'
import { ensureLocalPath } from '../files/actions'
import { findNode, nodePath, splitLocalPath } from '../files/paths'
import { ensureRoleState } from '../state'
import type { BackupSet } from './schema'
import { BACKUP_STATE } from './state'

/** Options de récupération quand l'élément existe déjà à l'emplacement d'origine. */
export const RECOVERY_OPTIONS = ['CreateCopy', 'Overwrite', 'Skip'] as const
export type RecoveryOption = (typeof RECOVERY_OPTIONS)[number]

function requireBackup(draft: Draft<LabState>, deviceId: string): Draft<ServerDevice> {
  const server = requireDevice(draft, deviceId)
  if (server.kind !== 'server' || !server.host.features.includes('Windows-Server-Backup'))
    raise(
      'BackupNotInstalled',
      'La fonctionnalité Sauvegarde Windows Server n’est pas installée sur cet ordinateur.'
    )
  return server
}

/** Éléments à sauvegarder : chemins locaux existants, normalisés (C:\Compta). */
function validItems(server: Draft<ServerDevice>, items: string[]): string[] {
  return items.map((item) => {
    const clean = item.trim().replace(/\\+$/, '')
    if (!splitLocalPath(clean) || findNode(server.storage as Storage, clean) === undefined)
      raise(
        'PathNotFound',
        `L’élément « ${item} » est introuvable : indiquez un dossier ou un fichier local existant.`
      )
    const node = findNode(server.storage as Storage, clean)
    return node ? nodePath(server.storage as Storage, node.id) : 'C:\\'
  })
}

function validTarget(target: string): string {
  const t = target.trim()
  if (!/^[A-Za-z]:\\?$/.test(t) && !/^\\\\[^\\]+\\[^\\]+/.test(t))
    raise(
      'InvalidTarget',
      `La destination « ${target} » n’est pas valide : indiquez un volume (E:) ou un partage (\\\\serveur\\partage).`
    )
  if (/^c:/i.test(t))
    raise('InvalidTarget', 'La destination ne peut pas être un volume inclus dans la sauvegarde (C:).')
  return t.replace(/\\$/, '').replace(/^([a-z]):/, (m) => m.toUpperCase())
}

export interface PolicyInput {
  items: string[]
  systemState?: boolean
  target: string
  time: string
}

/** Planification de sauvegarde (quotidienne). */
export function setBackupPolicy(state: LabState, deviceId: string, input: PolicyInput): EngineResult {
  return transact(state, (draft) => {
    const server = requireBackup(draft, deviceId)
    const items = validItems(server, input.items)
    if (items.length === 0 && !input.systemState)
      raise('NothingToBackup', 'Sélectionnez au moins un élément à sauvegarder ou l’état du système.')
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time.trim()))
      raise('InvalidTime', `L’heure « ${input.time} » n’est pas valide (HH:MM).`)
    ensureRoleState(server, BACKUP_STATE).policy = {
      items,
      systemState: !!input.systemState,
      target: validTarget(input.target),
      time: input.time.trim()
    }
    return undefined
  })
}

export function removeBackupPolicy(state: LabState, deviceId: string): EngineResult {
  return transact(state, (draft) => {
    const backup = ensureRoleState(requireBackup(draft, deviceId), BACKUP_STATE)
    if (!backup.policy) raise('NoPolicy', 'Aucune sauvegarde planifiée n’est configurée.')
    backup.policy = null
    return undefined
  })
}

/**
 * Sauvegarde immédiate : éléments donnés, ou ceux de la stratégie planifiée (`input` null).
 * Renvoie l'identificateur de version.
 */
export function startBackup(
  state: LabState,
  deviceId: string,
  input: { items: string[]; systemState?: boolean; target: string } | null
): EngineResult<string> {
  return transact(state, (draft) => {
    const server = requireBackup(draft, deviceId)
    const backup = ensureRoleState(server, BACKUP_STATE)
    const source = input ?? backup.policy
    if (!source) raise('NoPolicy', 'Aucune sauvegarde planifiée : indiquez les éléments et la destination.')
    const items = validItems(server, source.items)
    if (items.length === 0 && !source.systemState)
      raise('NothingToBackup', 'Sélectionnez au moins un élément à sauvegarder ou l’état du système.')
    const target = validTarget(source.target)
    const storage = server.storage as Storage
    const entries: BackupSet['entries'] = []
    const seen = new Set<string>()
    for (const item of items) {
      // Élément et tout son contenu (C:\ : tout le volume)
      const root = findNode(storage, item)
      const ids = new Set(
        root ? [root.id] : storage.nodes.filter((n) => n.parentId === null).map((n) => n.id)
      )
      let grew = true
      while (grew) {
        grew = false
        for (const n of storage.nodes)
          if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
            ids.add(n.id)
            grew = true
          }
      }
      for (const n of storage.nodes) {
        if (!ids.has(n.id) || seen.has(n.id)) continue
        seen.add(n.id)
        entries.push({
          path: nodePath(storage, n.id),
          kind: n.kind,
          size: n.size,
          modifiedAt: n.modifiedAt,
          acl: n.acl.map((a) => ({ ...a })),
          inherits: n.inherits,
          owner: n.owner
        })
      }
    }
    const [date = '', time = ''] = formatShortDate(draft.clock).split(' ')
    const base = `${date}-${time.slice(0, 5)}`
    let version = base
    for (let n = 2; backup.sets.some((s) => s.version === version); n++) version = `${base} (${n})`
    backup.sets.push({
      version,
      time: draft.clock,
      target,
      items,
      systemState: !!source.systemState,
      entries
    })
    logEvent(draft, server.id, {
      level: 'information',
      source: 'Backup',
      eventId: 4,
      log: 'Application',
      message: `L’opération de sauvegarde s’est terminée avec succès (version ${version}).`
    })
    return version
  })
}

/**
 * Récupère un fichier ou un dossier (et son contenu) d'une version à son emplacement d'origine.
 * Renvoie le nombre d'éléments récupérés.
 */
export function recoverItem(
  state: LabState,
  deviceId: string,
  version: string,
  item: string,
  option: RecoveryOption = 'CreateCopy'
): EngineResult<number> {
  return transact(state, (draft) => {
    const server = requireBackup(draft, deviceId)
    const set = ensureRoleState(server, BACKUP_STATE).sets.find((s) => s.version === version.trim())
    if (!set) raise('VersionNotFound', `La version de sauvegarde « ${version} » est introuvable.`)
    const wanted = item.trim().replace(/\\+$/, '').toLowerCase()
    const selected = set.entries.filter((e) => {
      const p = e.path.toLowerCase()
      return p === wanted || p.startsWith(`${wanted}\\`)
    })
    if (selected.length === 0)
      raise('ItemNotFound', `L’élément « ${item} » ne figure pas dans cette sauvegarde.`)
    const storage = () => server.storage as Storage
    // Rétablit un élément (créé au besoin) avec les attributs sauvegardés
    const restore = (path: string, entry: (typeof selected)[number]) => {
      ensureLocalPath(draft, server, path, entry.kind, entry.size)
      const id = findNode(storage(), path)?.id
      const node = server.storage.nodes.find((n) => n.id === id)
      if (!node) return
      node.size = entry.size
      node.modifiedAt = entry.modifiedAt
      node.acl = entry.acl.map((a) => ({ ...a }))
      node.inherits = entry.inherits
      if (entry.owner) node.owner = entry.owner
    }
    let count = 0
    for (const entry of [...selected].sort((a, b) => a.path.length - b.path.length)) {
      const existing = findNode(storage(), entry.path)
      if (!existing) {
        restore(entry.path, entry)
        count++
      } else if (entry.kind === 'folder') {
        if (option === 'Overwrite') restore(entry.path, entry)
      } else if (option === 'Overwrite') {
        restore(entry.path, entry)
        count++
      } else if (option === 'CreateCopy') {
        // Les deux versions sont conservées : « Copie de <nom> »
        const cut = entry.path.lastIndexOf('\\')
        restore(`${entry.path.slice(0, cut)}\\Copie de ${entry.path.slice(cut + 1)}`, entry)
        count++
      }
    }
    return count
  })
}
