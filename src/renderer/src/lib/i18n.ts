/**
 * Langue de l'interface côté renderer : fixée par le main (préférence Affichage > Langue, langue du
 * système par défaut), reçue au chargement puis par la commande de menu `view:language`.
 * - Composants : `const { t } = useT()` (re-rendu au changement de langue).
 * - Gestionnaires d'évènements, notifications, fonctions utilitaires : `t()` (langue courante).
 */
import { createElement, Fragment, useMemo, type ReactNode } from 'react'
import { create } from 'zustand'
import { translate, translatePlural, type MessageKey, type MessageParams, type PluralKey } from '@shared/i18n'
import type { Lang } from '@shared/ipc'

interface LangState {
  lang: Lang
  setLang: (lang: Lang) => void
}

/** Langue transmise par le main (français si l'API est absente, ex. tests). */
function initialLang(): Lang {
  return window.serverlab?.initialLanguage === 'en' ? 'en' : 'fr'
}

/** Attribut lang du document (lecteurs d'écran, césure, guillemets typographiques). */
function applyToDocument(lang: Lang): void {
  document.documentElement.lang = lang
}

export const useLangStore = create<LangState>()((set) => ({
  lang: initialLang(),
  setLang: (lang) => {
    applyToDocument(lang)
    set({ lang })
  }
}))

applyToDocument(useLangStore.getState().lang)

/** Langue courante. */
export function currentLang(): Lang {
  return useLangStore.getState().lang
}

/** Locale des dates et heures affichées par l'interface. */
export function dateLocale(lang: Lang): string {
  return lang === 'fr' ? 'fr-FR' : 'en-GB'
}

/** Message traduit dans la langue courante (hors rendu). */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(currentLang(), key, params)
}

/** Message au pluriel dans la langue courante (hors rendu). */
export function tp(base: PluralKey, count: number, params?: MessageParams): string {
  return translatePlural(currentLang(), base, count, params)
}

export interface Translator {
  lang: Lang
  t: (key: MessageKey, params?: MessageParams) => string
  tp: (base: PluralKey, count: number, params?: MessageParams) => string
}

/** Traduction dans un composant : le composant est rendu de nouveau quand la langue change. */
export function useT(): Translator {
  const lang = useLangStore((s) => s.lang)
  return useMemo(
    () => ({
      lang,
      t: (key, params) => translate(lang, key, params),
      tp: (base, count, params) => translatePlural(lang, base, count, params)
    }),
    [lang]
  )
}

/**
 * Message mis en forme : chaque paramètre `{nom}` est remplacé par un élément React (texte en gras,
 * lien…), le reste du message reste du texte. Ex. rich(t('cle'), { vert: <b>vert</b> }).
 */
export function rich(template: string, nodes: Readonly<Record<string, ReactNode>>): ReactNode[] {
  return template.split(/(\{\w+\})/).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1]
    const node = name !== undefined && name in nodes ? nodes[name] : part
    return createElement(Fragment, { key: i }, node)
  })
}
