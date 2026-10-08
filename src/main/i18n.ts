/**
 * Langue du process principal (menus, dialogues natifs, erreurs renvoyées au renderer) :
 * fixée au démarrage puis à chaque choix dans Affichage > Langue.
 */
import { app } from 'electron'
import type { Lang, LanguagePreference } from '../shared/ipc'
import { resolveLanguage, translate, type MessageKey, type MessageParams } from '../shared/i18n'

let current: Lang = 'fr'

/** Langues du système, de la préférée à la moins préférée (locale de l'application en dernier recours). */
function systemLanguages(): string[] {
  return [...app.getPreferredSystemLanguages(), app.getLocale()]
}

/** Applique la préférence (langue du système ou langue imposée) ; renvoie la langue appliquée. */
export function applyLanguage(preference: LanguagePreference): Lang {
  current = resolveLanguage(preference, systemLanguages())
  return current
}

/** Langue appliquée. */
export function currentLanguage(): Lang {
  return current
}

/** Message traduit dans la langue appliquée. */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(current, key, params)
}
