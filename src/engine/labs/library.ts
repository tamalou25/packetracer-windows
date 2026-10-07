/**
 * Bibliothèque communautaire de labs : index JSON (dépôt GitHub public séparé) validé par zod,
 * puis lab téléchargé vérifié par son empreinte SHA-256 et par le schéma des labs. Un lab n'est
 * que des données : aucun contenu n'est exécuté ni interprété comme du HTML.
 */
import { z } from 'zod'
import { parseLabText, type LabDefinition } from './lab'
import { sha256 } from './sha256'

export const LIBRARY_FORMAT_VERSION = 1

/** Taille maximale de l'index (texte JSON). */
export const MAX_LIBRARY_INDEX_LENGTH = 256 * 1024

/** Chemin d'un lab dans le dépôt : labs/<nom>.json (aucun autre fichier n'est téléchargeable). */
export const LIBRARY_FILE_PATTERN = /^labs\/[a-z0-9][a-z0-9-]{0,79}\.json$/

export const LibraryEntrySchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  title: z.string().min(1).max(120),
  author: z.string().min(1).max(80),
  difficulty: z.enum(['Débutant', 'Intermédiaire', 'Avancé']),
  /** Version du lab (SemVer). */
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  summary: z.string().max(400).default(''),
  file: z.string().regex(LIBRARY_FILE_PATTERN),
  sha256: z.string().regex(/^[0-9a-f]{64}$/)
})

export const LibraryIndexSchema = z.strictObject({
  formatVersion: z.literal(LIBRARY_FORMAT_VERSION),
  labs: z.array(LibraryEntrySchema).max(500)
})

export type LibraryEntry = z.infer<typeof LibraryEntrySchema>
export type LibraryIndex = z.infer<typeof LibraryIndexSchema>

export type LibraryIndexResult = { ok: true; index: LibraryIndex } | { ok: false; message: string }

/** Valide le texte de l'index (taille, JSON, schéma strict, identifiants uniques). */
export function parseLibraryIndex(text: string): LibraryIndexResult {
  if (text.length > MAX_LIBRARY_INDEX_LENGTH)
    return { ok: false, message: 'Index de la bibliothèque invalide : fichier trop volumineux.' }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, message: 'Index de la bibliothèque invalide : JSON illisible.' }
  }
  const parsed = LibraryIndexSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue && issue.path.length > 0 ? ` (champ ${issue.path.join('.')})` : ''
    return {
      ok: false,
      message: `Index de la bibliothèque invalide${where} : ${issue?.message ?? 'structure inattendue'}.`
    }
  }
  const ids = new Set<string>()
  for (const entry of parsed.data.labs) {
    if (ids.has(entry.id))
      return { ok: false, message: `Index de la bibliothèque invalide : lab « ${entry.id} » en double.` }
    ids.add(entry.id)
  }
  return { ok: true, index: parsed.data }
}

export type LibraryLabResult = { ok: true; lab: LabDefinition } | { ok: false; message: string }

/**
 * Vérifie un lab téléchargé : empreinte SHA-256 identique à celle de l'index, schéma des labs,
 * identifiant et titre conformes à l'index.
 */
export function verifyLibraryLab(text: string, entry: LibraryEntry): LibraryLabResult {
  if (sha256(text) !== entry.sha256)
    return {
      ok: false,
      message: `Le lab « ${entry.title} » a été refusé : son empreinte SHA-256 ne correspond pas à l’index (fichier modifié ou incomplet).`
    }
  const parsed = parseLabText(text)
  if (!parsed.ok) return parsed
  if (parsed.lab.id !== entry.id)
    return {
      ok: false,
      message: `Le lab « ${entry.title} » a été refusé : son identifiant (${parsed.lab.id}) ne correspond pas à l’index.`
    }
  return { ok: true, lab: parsed.lab }
}
