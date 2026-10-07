/**
 * Bibliothèque communautaire de labs : adresse du dépôt public et règles des téléchargements
 * appliquées par le process principal (le contenu est ensuite vérifié par le moteur : empreinte
 * SHA-256, schéma zod).
 */

/** Racine du dépôt public des labs (fichier index.json et dossier labs/). */
export const DEFAULT_LIBRARY_URL = 'https://raw.githubusercontent.com/tamalou25/serverlab-labs/main/'

/** Chemin d'un lab dans le dépôt (même règle que LIBRARY_FILE_PATTERN du moteur). */
export const LIBRARY_FILE_PATTERN = /^labs\/[a-z0-9][a-z0-9-]{0,79}\.json$/

/** Tailles maximales téléchargées (index, lab). */
export const MAX_LIBRARY_INDEX_BYTES = 256 * 1024
export const MAX_LIBRARY_LAB_BYTES = 1024 * 1024

/**
 * Racine utilisée : celle du dépôt public, ou un serveur local de test (variable
 * SERVERLAB_LIBRARY_URL limitée à http://127.0.0.1:<port>/ ou http://localhost:<port>/).
 */
export function libraryBaseUrl(override: string | undefined): string {
  return override && /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}\/$/.test(override)
    ? override
    : DEFAULT_LIBRARY_URL
}

/** Adresse d'un fichier de la bibliothèque, ou null si le chemin n'est pas autorisé. */
export function libraryFileUrl(base: string, file: unknown): string | null {
  if (file === 'index.json') return `${base}index.json`
  return typeof file === 'string' && LIBRARY_FILE_PATTERN.test(file) ? `${base}${file}` : null
}
