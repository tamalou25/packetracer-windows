/**
 * Bibliothèque communautaire : index et labs téléchargés par le process principal, vérifiés par
 * le moteur (index strict, empreinte SHA-256, schéma des labs) avant ouverture.
 */
import { parseLibraryIndex, verifyLibraryLab, type LibraryEntry, type LibraryIndex } from '@engine/index'
import { openLab } from './labs'

export type IndexResult = { ok: true; index: LibraryIndex } | { ok: false; message: string }

export async function loadLibraryIndex(): Promise<IndexResult> {
  const res = await window.serverlab.libraryIndex()
  if (!res.ok) return { ok: false, message: res.error ?? 'Bibliothèque indisponible.' }
  return parseLibraryIndex(res.value)
}

/** Télécharge, vérifie et ouvre un lab ; renvoie un message d'erreur, ou null en cas de succès. */
export async function openLibraryLab(entry: LibraryEntry): Promise<string | null> {
  const res = await window.serverlab.libraryLab(entry.file)
  if (!res.ok) return res.error ?? 'Téléchargement impossible.'
  const verified = verifyLibraryLab(res.value, entry)
  if (!verified.ok) return verified.message
  await openLab(verified.lab)
  return null
}
