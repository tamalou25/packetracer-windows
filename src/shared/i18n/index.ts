/**
 * Langue de l'interface (français / anglais) : préférence, langue appliquée et traduction des clés.
 *
 * - Le français est la langue de référence (`fr.ts`) : `en.ts` doit fournir exactement les mêmes clés,
 *   avec les mêmes paramètres (vérifié à la compilation et par tests/shared/i18n.test.ts).
 * - Paramètres : `{nom}` dans le texte, remplacés par `translate(lang, clé, { nom: … })`.
 * - Pluriels : clés `<base>.one` et `<base>.other`, choisies par Intl.PluralRules de la langue
 *   (en français, 0 et 1 sont au singulier ; en anglais, seul 1).
 * - Hors champ, volontairement en français : le système simulé (Bureau, consoles d'administration,
 *   sorties des commandes, messages du moteur), comme un serveur installé en français, et le contenu
 *   des labs (énoncés, critères, indices), qui sont des données.
 */
import type { Lang, LanguagePreference } from '../ipc'
import { en } from './en'
import { fr, type MessageKey } from './fr'

export type { MessageKey }

/** Messages de chaque langue (même jeu de clés). */
export const MESSAGES: Readonly<Record<Lang, Readonly<Record<MessageKey, string>>>> = { fr, en }

/** Nom de chaque langue dans cette langue (identique quelle que soit la langue de l'interface). */
export const LANGUAGE_NAMES: Readonly<Record<Lang, string>> = { fr: 'Français', en: 'English' }

/** Valeurs des paramètres `{nom}` d'un message. */
export type MessageParams = Readonly<Record<string, string | number>>

/** Clés de base des messages au pluriel (`<base>.one` et `<base>.other`). */
export type PluralKey = {
  [K in MessageKey]: K extends `${infer Base}.one`
    ? `${Base}.other` extends MessageKey
      ? Base
      : never
    : never
}[MessageKey]

/**
 * Langue appliquée : le choix explicite, sinon la première langue du système prise en charge
 * (« fr-FR », « fr_CA.UTF-8 », « en-US »…), sinon l'anglais.
 */
export function resolveLanguage(preference: LanguagePreference, systemLanguages: readonly string[]): Lang {
  if (preference !== 'system') return preference
  for (const tag of systemLanguages) {
    const primary = tag
      .trim()
      .toLowerCase()
      .split(/[-_.@]/)[0]
    if (primary === 'fr' || primary === 'en') return primary
  }
  return 'en'
}

/** Remplace les paramètres `{nom}` (un paramètre absent reste tel quel, visible en test). */
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  )
}

/** Message traduit d'une clé. */
export function translate(lang: Lang, key: MessageKey, params?: MessageParams): string {
  return interpolate(MESSAGES[lang][key], params)
}

/** Message au pluriel : `{count}` est fourni automatiquement. */
export function translatePlural(lang: Lang, base: PluralKey, count: number, params?: MessageParams): string {
  const form = new Intl.PluralRules(lang).select(count) === 'one' ? 'one' : 'other'
  return translate(lang, `${base}.${form}` as MessageKey, { count, ...params })
}

/** Paramètres `{nom}` présents dans un message (comparaison des langues dans les tests). */
export function placeholders(template: string): string[] {
  return [...new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? ''))].sort()
}
