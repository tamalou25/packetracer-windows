/**
 * Chemins du volume C: d'un serveur (C:\Partages\Compta) et chemins réseau (\\SRV1\Compta\Budget).
 * Les noms ne tiennent pas compte de la casse, comme sur le système simulé.
 */
import type { FsNode, SmbShare, Storage } from '../../model/schema'

export const ROOT_PATH = 'C:\\'

/** Découpe un chemin local en noms de dossiers (null si ce n'est pas un chemin du volume C:). */
export function splitLocalPath(path: string): string[] | null {
  const p = path.trim().replace(/\//g, '\\')
  const m = /^c:(\\.*)?$/i.exec(p)
  if (!m) return null
  return (m[1] ?? '').split('\\').filter((x) => x.length > 0 && x !== '.')
}

/** Nœud désigné par un chemin local : null = racine, undefined = introuvable. */
export function findNode(storage: Storage, path: string): FsNode | null | undefined {
  const parts = splitLocalPath(path)
  if (parts === null) return undefined
  let current: FsNode | null = null
  for (const part of parts) {
    if (part === '..') {
      const up: string | null = current ? current.parentId : null
      current = up ? (storage.nodes.find((n) => n.id === up) ?? null) : null
      continue
    }
    const parentId: string | null = current?.id ?? null
    const next = storage.nodes.find(
      (n) => n.parentId === parentId && n.name.toLowerCase() === part.toLowerCase()
    )
    if (!next) return undefined
    current = next
  }
  return current
}

/** Chemin local d'un nœud (C:\Partages\Compta). */
export function nodePath(storage: Storage, nodeId: string | null): string {
  const names: string[] = []
  let current = nodeId ? storage.nodes.find((n) => n.id === nodeId) : undefined
  while (current) {
    names.unshift(current.name)
    const parentId = current.parentId
    current = parentId ? storage.nodes.find((n) => n.id === parentId) : undefined
  }
  return `${ROOT_PATH}${names.join('\\')}`
}

/** Enfants directs d'un dossier (dossiers d'abord, puis fichiers, par nom). */
export function childrenOf(storage: Storage, nodeId: string | null): FsNode[] {
  return storage.nodes
    .filter((n) => n.parentId === nodeId)
    .sort((a, b) =>
      a.kind === b.kind
        ? a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })
        : a.kind === 'folder'
          ? -1
          : 1
    )
}

/** Le nœud `id` est-il `ancestorId` ou l'un de ses descendants ? */
export function isWithin(storage: Storage, id: string | null, ancestorId: string | null): boolean {
  if (ancestorId === null) return true
  let current: string | null = id
  while (current) {
    if (current === ancestorId) return true
    current = storage.nodes.find((n) => n.id === current)?.parentId ?? null
  }
  return false
}

/**
 * Noms de périphériques réservés, avec ou sans extension (CON, NUL.txt, COM1…) : Microsoft Learn,
 * « Naming Files, Paths, and Namespaces ».
 */
const RESERVED_NAME = /^(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])(\.[^.]*)?$/i

/**
 * Nom normalisé comme par Windows : points et espaces finaux retirés (Microsoft Learn, « File path
 * formats on Windows systems », Trim characters). « Data. » désigne donc « Data ».
 */
export function normalizeItemName(name: string): string {
  return /^\.+$/.test(name.trim()) ? name : name.replace(/[. ]+$/, '')
}

/** Nom de fichier ou de dossier valide sur le système simulé. */
export function validItemName(name: string): boolean {
  return (
    name.trim().length > 0 &&
    !/[\\/:*?"<>|]/.test(name) &&
    !/^\.+$/.test(name.trim()) &&
    !RESERVED_NAME.test(name)
  )
}

/** Chemin réseau : \\serveur\partage\reste. */
export interface UncPath {
  server: string
  share: string
  /** Sous-dossiers après le partage. */
  rest: string[]
}

export function parseUnc(path: string): UncPath | null {
  const p = path.trim().replace(/\//g, '\\')
  if (!p.startsWith('\\\\')) return null
  const [server = '', share = '', ...rest] = p.slice(2).split('\\')
  if (!server) return null
  return { server, share, rest: rest.filter((x) => x.length > 0) }
}

export function formatUnc(unc: UncPath): string {
  return `\\\\${[unc.server, unc.share, ...unc.rest].filter((x) => x).join('\\')}`
}

/** Partages ouverts sur ce dossier précis (onglet Partage). */
export function sharesOn(storage: Storage, nodeId: string | null): SmbShare[] {
  return nodeId === null ? [] : storage.shares.filter((s) => s.folderId === nodeId)
}

/** Partages donnant accès à un élément : le dossier lui-même ou un dossier parent (Accès effectif). */
export function sharesCovering(storage: Storage, nodeId: string | null): SmbShare[] {
  const ancestors = new Set<string>()
  for (let current = nodeId; current; current = storage.nodes.find((n) => n.id === current)?.parentId ?? null)
    ancestors.add(current)
  return storage.shares.filter((s) => ancestors.has(s.folderId))
}
