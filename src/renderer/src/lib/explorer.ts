/**
 * Explorateur de fichiers simulé : résolution d'un emplacement (Ce PC, chemin local d'un serveur,
 * chemin réseau ou lecteur mappé) en contenu affichable, avec les droits de l'utilisateur.
 * Toute la logique d'accès vient du moteur (mêmes règles que les consoles).
 */
import {
  accessPerms,
  childrenOf,
  expandDrivePath,
  findNode,
  localToken,
  openUnc,
  parseUnc,
  principalName,
  sessionToken,
  WELL_KNOWN_SIDS,
  type AccessToken,
  type Domain,
  type FsNode,
  type HostDevice,
  type LabState,
  type PacketTrace,
  type Perm,
  type ServerDevice,
  type SmbShare
} from '@engine/index'

/** Emplacement affiché par l'Explorateur : « Ce PC » ou un chemin. */
export const THIS_PC = 'Ce PC'

export type ExplorerView =
  | { kind: 'thispc' }
  | { kind: 'client-volume' }
  | { kind: 'error'; title: string; message: string }
  | {
      kind: 'folder'
      server: ServerDevice
      nodeId: string | null
      /** Chemin local sur le serveur. */
      localPath: string
      share?: SmbShare
      perms: Set<Perm>
      items: FsNode[]
      trace: PacketTrace | null
    }

/** Jeton de la session ouverte sur l'ordinateur (sinon compte local par défaut). */
export function explorerToken(lab: LabState, device: HostDevice): AccessToken {
  return (
    sessionToken(lab, device.id) ??
    localToken(device.name, device.kind === 'server' ? 'Administrateur' : 'Utilisateur')
  )
}

/** Messages d'erreur de l'Explorateur selon l'erreur système. */
export function networkError(path: string, code: number, error: string): { title: string; message: string } {
  switch (code) {
    case 5:
      return {
        title: path,
        message: `Vous n’avez pas l’autorisation d’accéder à ${path}.\nContactez votre administrateur réseau pour demander l’accès.`
      }
    case 3:
      return {
        title: 'Explorateur de fichiers',
        message: `Impossible de trouver « ${path} ». Vérifiez l’orthographe et réessayez.`
      }
    case 67:
      return {
        title: 'Erreur réseau',
        message: `Impossible d’accéder à ${path}\n\nCode d’erreur : 0x80070043\n${error}`
      }
    default:
      return {
        title: 'Erreur réseau',
        message: `Impossible d’accéder à ${path}\n\nVérifiez l’orthographe du nom. Sinon, il se peut qu’il y ait un problème avec votre réseau.\n\nCode d’erreur : 0x80070035\n${error}`
      }
  }
}

/** Résout un emplacement pour l'affichage (aucune modification de l'état). */
export function resolveLocation(lab: LabState, device: HostDevice, location: string): ExplorerView {
  if (location === THIS_PC || location.trim() === '') return { kind: 'thispc' }
  const token = explorerToken(lab, device)
  const expanded = expandDrivePath(device, token.account, location.trim())
  const unc = parseUnc(expanded)
  if (unc) {
    if (!unc.share)
      return { kind: 'error', ...networkError(location, 53, 'Le chemin réseau n’a pas été trouvé.') }
    const opened = openUnc(lab, device.id, expanded, token)
    if (!opened.ok) return { kind: 'error', ...networkError(location, opened.code, opened.error) }
    const { server, nodeId, share, perms, localPath } = opened.target
    const node = nodeId ? server.storage.nodes.find((n) => n.id === nodeId) : null
    if (node?.kind === 'file')
      return { kind: 'error', title: 'Explorateur de fichiers', message: `« ${location} » est un fichier.` }
    if (!perms.has('list')) return { kind: 'error', ...networkError(location, 5, '') }
    return {
      kind: 'folder',
      server,
      nodeId,
      localPath,
      share,
      perms,
      items: childrenOf(server.storage, nodeId),
      trace: opened.trace
    }
  }
  if (!/^c:/i.test(expanded))
    return {
      kind: 'error',
      title: 'Explorateur de fichiers',
      message: `Impossible de trouver « ${location} ». Vérifiez l’orthographe et réessayez.`
    }
  if (device.kind !== 'server') return { kind: 'client-volume' }
  const node = findNode(device.storage, expanded)
  if (node === undefined || node?.kind === 'file')
    return {
      kind: 'error',
      title: 'Explorateur de fichiers',
      message: `Impossible de trouver « ${location} ». Vérifiez l’orthographe et réessayez.`
    }
  const perms = accessPerms(device.storage, node?.id ?? null, token)
  if (!perms.has('list'))
    return {
      kind: 'error',
      title: 'Explorateur de fichiers',
      message: 'Vous n’avez pas l’autorisation d’accéder à ce dossier.'
    }
  return {
    kind: 'folder',
    server: device,
    nodeId: node?.id ?? null,
    localPath: expanded,
    perms,
    items: childrenOf(device.storage, node?.id ?? null),
    trace: null
  }
}

/** Dossier parent d'un emplacement (null : déjà à la racine). */
export function parentLocation(location: string): string | null {
  if (location === THIS_PC) return null
  const trimmed = location.replace(/\\$/, '')
  const unc = parseUnc(trimmed)
  if (unc)
    return unc.rest.length === 0
      ? THIS_PC
      : `\\\\${[unc.server, unc.share, ...unc.rest.slice(0, -1)].join('\\')}`
  const parts = trimmed.split('\\')
  if (parts.length <= 1) return THIS_PC
  return parts.length === 2 ? `${parts[0]}\\` : parts.slice(0, -1).join('\\')
}

/** Joint un nom à un emplacement (C:\ + Partages → C:\Partages). */
export function joinLocation(location: string, name: string): string {
  return location.endsWith('\\') ? `${location}${name}` : `${location}\\${name}`
}

/** Comptes proposés dans les sélecteurs (Sécurité, Partage, Accès effectif). */
export function accountOptions(lab: LabState, server: ServerDevice): { value: string; label: string }[] {
  const domain: Domain | undefined = server.host.domain ? lab.domains[server.host.domain] : undefined
  const builtin = domain?.containers.find((c) => c.name === 'Builtin' && c.parentId === null)?.id
  const wellKnown = [
    WELL_KNOWN_SIDS.everyone,
    WELL_KNOWN_SIDS.authenticatedUsers,
    WELL_KNOWN_SIDS.administrators,
    WELL_KNOWN_SIDS.users,
    WELL_KNOWN_SIDS.system
  ].map((sid) => ({ value: principalName(lab, server, sid), label: principalName(lab, server, sid) }))
  if (!domain) return wellKnown
  return [
    ...wellKnown,
    ...domain.groups
      .filter((g) => g.parentId !== builtin)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      .map((g) => ({ value: `${domain.netbios}\\${g.sam}`, label: `${domain.netbios}\\${g.name} (groupe)` })),
    ...domain.users
      .filter((u) => u.enabled)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      .map((u) => ({
        value: `${domain.netbios}\\${u.sam}`,
        label: `${u.name} (${domain.netbios}\\${u.sam})`
      }))
  ]
}

/** Taille lisible (Ko, Mo). */
export function displaySize(bytes: number): string {
  if (bytes < 1024) return bytes === 0 ? '0 Ko' : '1 Ko'
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`
}

/** Type affiché d'un fichier selon son extension. */
export function fileType(name: string, kind: 'folder' | 'file'): string {
  if (kind === 'folder') return 'Dossier de fichiers'
  const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : ''
  const types: Record<string, string> = {
    txt: 'Document texte',
    docx: 'Document',
    xlsx: 'Feuille de calcul',
    pdf: 'Document PDF',
    jpg: 'Fichier JPG',
    png: 'Fichier PNG',
    bmp: 'Fichier BMP'
  }
  return types[ext] ?? (ext ? `Fichier ${ext.toUpperCase()}` : 'Fichier')
}
