/**
 * Lecture et écriture des fichiers .slab (JSON versionné).
 */
import { z } from 'zod'
import { LabStateSchema, type LabState } from '../model/schema'
import { validateRoleStates } from '../roles/validation'
import { CURRENT_SCHEMA_VERSION, migrateDocument } from './migrations'

export const SLAB_EXTENSION = 'slab'

export const ViewportSchema = z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() })

export const SlabDocumentSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  app: z.literal('ServerLab'),
  appVersion: z.string().default('0.0.0'),
  savedAt: z.string(),
  meta: z
    .object({
      title: z.string().default(''),
      description: z.string().default(''),
      /** Lab pédagogique en cours (identifiant du fichier labs/*.json), '' sinon. */
      labId: z.string().default('')
    })
    .default({ title: '', description: '', labId: '' }),
  lab: LabStateSchema,
  ui: z.object({ viewport: ViewportSchema.nullable().default(null) }).default({ viewport: null })
})

export type SlabDocument = z.infer<typeof SlabDocumentSchema>
export type Viewport = z.infer<typeof ViewportSchema>

export interface SerializeOptions {
  /** Date ISO de l'enregistrement (fournie par l'appelant : le moteur n'accède pas à l'horloge système). */
  savedAt: string
  appVersion: string
  viewport?: Viewport | null
  meta?: { title?: string; description?: string; labId?: string }
}

export function createSlabDocument(lab: LabState, options: SerializeOptions): SlabDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    app: 'ServerLab',
    appVersion: options.appVersion,
    savedAt: options.savedAt,
    meta: {
      title: options.meta?.title ?? '',
      description: options.meta?.description ?? '',
      labId: options.meta?.labId ?? ''
    },
    lab,
    ui: { viewport: options.viewport ?? null }
  }
}

export function serializeSlab(lab: LabState, options: SerializeOptions): string {
  return JSON.stringify(createSlabDocument(lab, options), null, 2)
}

export type ParseResult = { ok: true; doc: SlabDocument } | { ok: false; message: string }

/**
 * Longueur maximale d'un document .slab (même limite que MAX_SLAB_BYTES côté process principal :
 * un texte de N octets UTF-8 compte au plus N caractères).
 */
export const MAX_SLAB_LENGTH = 20 * 1024 * 1024

/**
 * Analyse, migre et valide le contenu d'un fichier .slab (ouvert, récent ou de récupération).
 * Ne lève jamais d'exception : tout contenu invalide donne un message en français. Les champs
 * inconnus (fichier d'une version plus récente, ajout manuel) sont ignorés et retirés.
 */
export function parseSlab(content: string): ParseResult {
  if (content.length > MAX_SLAB_LENGTH)
    return { ok: false, message: 'Le fichier est trop volumineux pour un lab ServerLab.' }
  try {
    return parseSlabContent(content)
  } catch {
    // Filet de sécurité : une incohérence non prévue ne doit jamais faire planter l'application
    return { ok: false, message: 'Le fichier .slab est illisible (structure inattendue).' }
  }
}

function parseSlabContent(content: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return { ok: false, message: 'Le fichier n’est pas un document ServerLab valide (JSON illisible).' }
  }
  return parseSlabValue(raw)
}

/**
 * Migre et valide un document .slab déjà lu (objet JSON) : départ « instantané » d'un lab.
 * Ne lève jamais d'exception.
 */
export function parseSlabValue(raw: unknown): ParseResult {
  try {
    return parseSlabObject(raw)
  } catch {
    return { ok: false, message: 'Le document ServerLab est illisible (structure inattendue).' }
  }
}

function parseSlabObject(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, message: 'Le fichier n’est pas un document ServerLab valide.' }
  }
  const record = raw as Record<string, unknown>
  if (record['app'] !== 'ServerLab') {
    return { ok: false, message: 'Ce fichier n’a pas été créé par ServerLab.' }
  }
  const migrated = migrateDocument(record)
  if (!migrated.ok) return { ok: false, message: migrated.message }

  const parsed = SlabDocumentSchema.safeParse(migrated.doc)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue && issue.path.length > 0 ? ` (champ ${issue.path.join('.')})` : ''
    return {
      ok: false,
      message: `Fichier .slab invalide${where} : ${issue?.message ?? 'structure inattendue'}.`
    }
  }
  // Données des rôles : schéma déclaré par chaque module (valeurs par défaut appliquées)
  const roles = validateRoleStates(parsed.data.lab)
  if (roles) return { ok: false, message: roles }
  const integrity = checkIntegrity(parsed.data.lab)
  if (integrity) return { ok: false, message: `Fichier .slab incohérent : ${integrity}` }
  return { ok: true, doc: parsed.data }
}

/** Vérifie la cohérence interne (câbles vers des ports existants, port utilisé une seule fois…). */
export function checkIntegrity(lab: LabState): string | null {
  for (const [key, device] of Object.entries(lab.devices)) {
    if (device.id !== key) return `identifiant d’équipement incohérent (${key}).`
  }
  const usedPorts = new Set<string>()
  for (const [key, link] of Object.entries(lab.links)) {
    if (link.id !== key) return `identifiant de câble incohérent (${key}).`
    for (const end of [link.a, link.b]) {
      const device = lab.devices[end.deviceId]
      if (!device) return `le câble ${key} référence un équipement inexistant.`
      if (!device.interfaces.some((i) => i.id === end.ifaceId))
        return `le câble ${key} référence un port inexistant sur ${device.name}.`
      const portKey = `${end.deviceId}/${end.ifaceId}`
      if (usedPorts.has(portKey)) return `le port ${end.ifaceId} de ${device.name} est câblé deux fois.`
      usedPorts.add(portKey)
    }
  }
  return null
}
