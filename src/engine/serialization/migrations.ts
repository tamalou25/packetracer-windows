/**
 * Migrations du format .slab.
 * Chaque entrée transforme un document de la version N vers N+1.
 * Pour faire évoluer le format : incrémenter CURRENT_SCHEMA_VERSION et ajouter une migration.
 */
import { DEFAULT_DC_POLICY_ID, DEFAULT_DOMAIN_POLICY_ID, defaultDomainGpos } from '../services/gpo/defaults'

export const CURRENT_SCHEMA_VERSION = 3

type RawDocument = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Version 2 : stratégies de groupe. Les domaines existants reçoivent les deux GPO par défaut
 * (Default Domain Policy liée au domaine, Default Domain Controllers Policy liée à l'OU des DC).
 */
function addDefaultGpos(doc: RawDocument): RawDocument {
  const lab = doc['lab']
  if (isRecord(lab) && isRecord(lab['domains'])) {
    const clock = typeof lab['clock'] === 'number' ? lab['clock'] : 0
    for (const domain of Object.values(lab['domains'])) {
      if (!isRecord(domain) || Array.isArray(domain['gpos'])) continue
      domain['gpos'] = defaultDomainGpos(clock)
      domain['gpLinks'] = [{ gpoId: DEFAULT_DOMAIN_POLICY_ID, enabled: true, enforced: false }]
      const containers = Array.isArray(domain['containers']) ? domain['containers'] : []
      const dcs = containers.find(
        (c): c is Record<string, unknown> =>
          isRecord(c) && c['name'] === 'Domain Controllers' && c['parentId'] === null
      )
      if (dcs && !Array.isArray(dcs['gpLinks']))
        dcs['gpLinks'] = [{ gpoId: DEFAULT_DC_POLICY_ID, enabled: true, enforced: false }]
    }
  }
  return { ...doc, schemaVersion: 2 }
}

/** Version 3 : identifiant du lab pédagogique en cours (métadonnées). */
function addLabId(doc: RawDocument): RawDocument {
  const meta = isRecord(doc['meta']) ? doc['meta'] : {}
  return {
    ...doc,
    meta: { ...meta, labId: typeof meta['labId'] === 'string' ? meta['labId'] : '' },
    schemaVersion: 3
  }
}

/** migrations[n] migre un document de la version n vers n + 1. */
export const migrations: Record<number, (doc: RawDocument) => RawDocument> = {
  1: addDefaultGpos,
  2: addLabId
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
