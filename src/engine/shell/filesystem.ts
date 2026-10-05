/**
 * Fichiers depuis les consoles : dossier courant, chemins relatifs, lecteurs réseau et chemins
 * UNC, jeton de l'utilisateur de la session. Commun à PowerShell et à l'invite de commandes.
 */
import { formatShortDate } from '../core/clock'
import type { FsNode, ServerDevice, SmbShare } from '../model/schema'
import { localToken, sessionToken, type AccessToken } from '../roles/files/acl'
import { childrenOf, findNode, parseUnc } from '../roles/files/paths'
import { expandDrivePath, openUnc } from '../roles/files/smb'
import type { ExecContext } from './context'

/** Jeton de l'utilisateur de la console (session ouverte, sinon compte local par défaut). */
export function shellToken(ctx: ExecContext): AccessToken {
  return sessionToken(ctx.state, ctx.deviceId) ?? localToken(ctx.host.name, ctx.user.name)
}

/** Normalise « a\.\b\..\c » en « a\c » (sans remonter au-delà de la racine). */
function collapse(root: string, parts: string[]): string {
  const out: string[] = []
  for (const p of parts) {
    if (p === '' || p === '.') continue
    if (p === '..') out.pop()
    else out.push(p)
  }
  return `${root}${out.join('\\')}`
}

/** Chemin absolu à partir du dossier courant (C:\…, \\serveur\partage\…, Z:\…). */
export function absolutePath(cwd: string, path: string): string {
  const p = path.trim().replace(/^"|"$/g, '').replace(/\//g, '\\')
  if (p === '') return cwd
  if (p.startsWith('\\\\')) {
    const unc = parseUnc(p)
    return unc ? collapse(`\\\\${unc.server}\\${unc.share}\\`, unc.rest).replace(/\\$/, '') : p
  }
  const drive = /^([a-z]):(.*)$/i.exec(p)
  if (drive) return collapse(`${(drive[1] as string).toUpperCase()}:\\`, (drive[2] ?? '').split('\\'))
  // Chemin relatif ou depuis la racine du lecteur courant
  const base = cwd
  if (p.startsWith('\\')) {
    const root = base.startsWith('\\\\')
      ? base.split('\\').slice(0, 4).join('\\') + '\\'
      : `${base.slice(0, 2)}\\`
    return collapse(root, p.split('\\'))
  }
  if (base.startsWith('\\\\')) {
    const unc = parseUnc(base)
    if (!unc) return p
    return collapse(`\\\\${unc.server}\\${unc.share}\\`, [...unc.rest, ...p.split('\\')]).replace(/\\$/, '')
  }
  const root = `${base.slice(0, 2)}\\`
  return collapse(root, [...base.slice(3).split('\\'), ...p.split('\\')])
}

/** Emplacement traduit vers un serveur : chemin local, éventuellement au travers d'un partage. */
export interface FsTarget {
  server: ServerDevice
  /** Chemin local sur le serveur (C:\Partages\Compta\Budget). */
  localPath: string
  /** Partage traversé (accès réseau). */
  share?: SmbShare
  /** Chemin tel qu'affiché à l'utilisateur. */
  display: string
}

export type FsResolution = { ok: true; target: FsTarget } | { ok: false; error: string }

/**
 * Traduit un chemin de la console : local sur un serveur, ou réseau (UNC, lecteur mappé).
 * L'élément final n'a pas besoin d'exister (création).
 */
export function translatePath(ctx: ExecContext, path: string): FsResolution {
  const host = ctx.host
  const token = shellToken(ctx)
  const absolute = absolutePath(ctx.session.cwd, path)
  const expanded = expandDrivePath(host, token.account, absolute)
  const unc = parseUnc(expanded)
  if (unc) {
    if (!unc.share) return { ok: false, error: 'Le chemin réseau n’a pas été trouvé.' }
    const opened = openUnc(ctx.state, ctx.deviceId, `\\\\${unc.server}\\${unc.share}`, token)
    ctx.addTrace(opened.trace)
    if (!opened.ok) return { ok: false, error: opened.error }
    const base = opened.target.localPath.replace(/\\$/, '')
    return {
      ok: true,
      target: {
        server: opened.target.server,
        localPath: unc.rest.length === 0 ? opened.target.localPath : [base, ...unc.rest].join('\\'),
        share: opened.target.share,
        display: expanded
      }
    }
  }
  if (!/^c:/i.test(expanded)) return { ok: false, error: 'Le chemin d’accès spécifié est introuvable.' }
  if (host.kind !== 'server')
    return {
      ok: false,
      error:
        'Le volume C: des postes clients n’est pas simulé : utilisez un partage réseau (\\\\serveur\\partage).'
    }
  return { ok: true, target: { server: host, localPath: expanded, display: expanded } }
}

/** Élément existant au chemin traduit (null = racine), undefined s'il est introuvable. */
export function nodeAt(target: FsTarget): FsNode | null | undefined {
  return findNode(target.server.storage, target.localPath)
}

/** Contenu d'un dossier, trié comme l'Explorateur. */
export function listFolder(target: FsTarget, node: FsNode | null): FsNode[] {
  return childrenOf(target.server.storage, node?.id ?? null)
}

/** « 05/01/2026     08:00 » (colonne LastWriteTime). */
export function lastWrite(clock: number): string {
  const [date = '', time = ''] = formatShortDate(clock).split(' ')
  return `${date}     ${time.slice(0, 5)}`
}

/** « 1 024 » (séparateur de milliers français). */
export function formatBytes(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}
