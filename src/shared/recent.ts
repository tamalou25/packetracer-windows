/**
 * Fichiers récents : logique pure partagée par le process principal (liste enregistrée dans
 * recent.json) et l'écran d'accueil (affichage du nom, du dossier et de la date d'ouverture).
 */
import { translate } from './i18n'
import { MAX_RECENT } from './persisted'
import type { Lang, RecentFile } from './ipc'

/** Nom du fichier et dossier qui le contient, pour un chemin Windows ou Linux. */
export function splitPath(path: string): { name: string; folder: string } {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (i < 0) return { name: path, folder: '' }
  let folder = path.slice(0, i)
  // Racine : « / » ou « C:\ » plutôt qu'une chaîne vide ou « C: »
  if (folder === '' || /^[A-Za-z]:$/.test(folder)) folder += path[i]
  return { name: path.slice(i + 1), folder }
}

/** Formats de l'heure et du jour (24 h dans les deux langues). */
const LOCALE: Record<Lang, string> = { fr: 'fr-FR', en: 'en-GB' }
const TIME = (lang: Lang) => new Intl.DateTimeFormat(LOCALE[lang], { hour: '2-digit', minute: '2-digit' })
const DAY = (lang: Lang) =>
  new Intl.DateTimeFormat(LOCALE[lang], { day: 'numeric', month: 'short', year: 'numeric' })

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * Date de dernière ouverture, en heure locale : « Aujourd’hui, 14:05 », « Hier, 09:12 » ou
 * « 3 oct. 2026 » (en anglais : « Today, 14:05 », « 3 Oct 2026 »). Date illisible : chaîne vide.
 */
export function formatOpenedAt(iso: string, now: Date, lang: Lang): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  const time = TIME(lang).format(date)
  if (sameDay(date, now)) return translate(lang, 'recent.today', { time })
  if (sameDay(date, yesterday)) return translate(lang, 'recent.yesterday', { time })
  return DAY(lang).format(date)
}

/**
 * Fichier ouvert ou enregistré : placé en tête, sans doublon, liste limitée à MAX_RECENT.
 * `key` donne la clé de comparaison d'un chemin (insensible à la casse sous Windows).
 */
export function rememberRecent(
  list: readonly RecentFile[],
  entry: RecentFile,
  key: (path: string) => string
): RecentFile[] {
  const k = key(entry.path)
  return [entry, ...list.filter((r) => key(r.path) !== k)].slice(0, MAX_RECENT)
}

/** Retire un chemin de la liste (les autres entrées sont conservées dans le même ordre). */
export function forgetRecent(
  list: readonly RecentFile[],
  path: string,
  key: (path: string) => string
): RecentFile[] {
  const k = key(path)
  return list.filter((r) => key(r.path) !== k)
}
