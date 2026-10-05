/**
 * Migrations du format .slab.
 * Chaque entrée transforme un document de la version N vers N+1.
 * Pour faire évoluer le format : incrémenter CURRENT_SCHEMA_VERSION et ajouter une migration.
 */

export const CURRENT_SCHEMA_VERSION = 1

type RawDocument = Record<string, unknown>

/** migrations[n] migre un document de la version n vers n + 1. */
export const migrations: Record<number, (doc: RawDocument) => RawDocument> = {
  // Exemple pour la future version 2 :
  // 1: (doc) => ({ ...doc, schemaVersion: 2, ... })
}

export type MigrationResult = { ok: true; doc: RawDocument } | { ok: false; message: string }

/** Amène un document brut à la version courante du format. */
export function migrateDocument(doc: RawDocument): MigrationResult {
  const version = doc['schemaVersion']
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, message: 'Champ « schemaVersion » absent ou invalide.' }
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      message: `Ce fichier a été créé avec une version plus récente de ServerLab (format ${version}). Mettez l’application à jour.`
    }
  }
  let current = doc
  for (let v = version; v < CURRENT_SCHEMA_VERSION; v++) {
    const migrate = migrations[v]
    if (!migrate) return { ok: false, message: `Migration manquante depuis le format ${v}.` }
    current = migrate(current)
  }
  return { ok: true, doc: current }
}
