/**
 * Bibliothèque communautaire de labs : téléchargement de l'index et des labs depuis le dépôt
 * public (adresses construites ici, chemins sur liste blanche, taille et délai bornés). Le
 * contenu est vérifié ensuite par le moteur (empreinte SHA-256, schéma des labs).
 */
import { net } from 'electron'
import type { FileResult } from '../shared/ipc'
import {
  libraryBaseUrl,
  libraryFileUrl,
  MAX_LIBRARY_INDEX_BYTES,
  MAX_LIBRARY_LAB_BYTES
} from '../shared/library'

const TIMEOUT_MS = 15_000

async function download(url: string, maxBytes: number): Promise<FileResult<string>> {
  let res: Response
  try {
    res = await net.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' })
  } catch {
    return { ok: false, error: 'Bibliothèque injoignable : vérifiez la connexion Internet, puis réessayez.' }
  }
  if (!res.ok)
    return {
      ok: false,
      error:
        res.status === 404
          ? 'Fichier introuvable dans la bibliothèque (HTTP 404).'
          : `La bibliothèque a répondu par une erreur (HTTP ${res.status}).`
    }
  const length = Number(res.headers.get('content-length') ?? '0')
  if (length > maxBytes) return { ok: false, error: 'Fichier de la bibliothèque trop volumineux.' }
  const body = new Uint8Array(await res.arrayBuffer())
  if (body.byteLength > maxBytes) return { ok: false, error: 'Fichier de la bibliothèque trop volumineux.' }
  try {
    return { ok: true, value: new TextDecoder('utf-8', { fatal: true }).decode(body) }
  } catch {
    return { ok: false, error: 'Fichier de la bibliothèque illisible (encodage invalide).' }
  }
}

const base = () => libraryBaseUrl(process.env['SERVERLAB_LIBRARY_URL'])

export function fetchLibraryIndex(): Promise<FileResult<string>> {
  return download(`${base()}index.json`, MAX_LIBRARY_INDEX_BYTES)
}

export async function fetchLibraryLab(file: unknown): Promise<FileResult<string>> {
  const url = file === 'index.json' ? null : libraryFileUrl(base(), file)
  if (!url) return { ok: false, error: 'Chemin de lab non autorisé.' }
  return download(url, MAX_LIBRARY_LAB_BYTES)
}
