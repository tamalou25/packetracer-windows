/**
 * Traductions de l'interface : les deux langues ont exactement les mêmes clés et les mêmes
 * paramètres (ce test échoue si une clé manque dans une langue), langue du système, pluriels.
 */
import { describe, expect, it } from 'vitest'
import {
  interpolate,
  MESSAGES,
  placeholders,
  resolveLanguage,
  translate,
  translatePlural,
  type MessageKey
} from '../../src/shared/i18n'
import { LANGS } from '../../src/shared/ipc'

const keysOf = (lang: 'fr' | 'en'): string[] => Object.keys(MESSAGES[lang]).sort()

describe('fichiers de langue', () => {
  it('chaque clé existe dans chaque langue', () => {
    const fr = keysOf('fr')
    const en = keysOf('en')
    expect(
      fr.filter((k) => !en.includes(k)),
      'clés absentes de en.ts'
    ).toEqual([])
    expect(
      en.filter((k) => !fr.includes(k)),
      'clés absentes de fr.ts'
    ).toEqual([])
    expect(fr.length).toBeGreaterThan(0)
  })

  it('aucun message vide, mêmes paramètres {nom} dans chaque langue', () => {
    for (const key of keysOf('fr') as MessageKey[]) {
      for (const lang of LANGS) expect(MESSAGES[lang][key]?.trim(), `${lang} : ${key}`).toBeTruthy()
      expect(placeholders(MESSAGES.en[key]), key).toEqual(placeholders(MESSAGES.fr[key]))
    }
  })

  it('pluriels complets : chaque clé .one a sa clé .other et inversement', () => {
    const keys = keysOf('fr')
    for (const key of keys) {
      if (key.endsWith('.one')) expect(keys, key).toContain(key.replace(/\.one$/, '.other'))
      if (key.endsWith('.other')) expect(keys, key).toContain(key.replace(/\.other$/, '.one'))
    }
  })
})

describe('langue appliquée', () => {
  it('choix explicite prioritaire sur le système', () => {
    expect(resolveLanguage('fr', ['en-US'])).toBe('fr')
    expect(resolveLanguage('en', ['fr-FR'])).toBe('en')
  })

  it('langue du système : première langue prise en charge, anglais à défaut', () => {
    expect(resolveLanguage('system', ['fr-FR', 'en-US'])).toBe('fr')
    expect(resolveLanguage('system', ['fr_CA.UTF-8'])).toBe('fr')
    expect(resolveLanguage('system', ['en-GB'])).toBe('en')
    expect(resolveLanguage('system', ['de-DE', 'fr-FR'])).toBe('fr')
    expect(resolveLanguage('system', ['de-DE'])).toBe('en')
    expect(resolveLanguage('system', [])).toBe('en')
  })
})

describe('traduction', () => {
  it('paramètres remplacés, paramètre inconnu laissé visible', () => {
    expect(interpolate('Bonjour {nom} ({n})', { nom: 'Gary', n: 2 })).toBe('Bonjour Gary (2)')
    expect(interpolate('Bonjour {nom}', {})).toBe('Bonjour {nom}')
    expect(translate('fr', 'update.upToDate.detail', { version: '2.4.0' })).toBe('Version installée : 2.4.0.')
    expect(translate('en', 'update.upToDate.detail', { version: '2.4.0' })).toBe('Installed version: 2.4.0.')
  })

  it('pluriel selon les règles de la langue (0 est singulier en français, pluriel en anglais)', () => {
    expect(translatePlural('fr', 'status.devices', 0)).toBe('0 équipement')
    expect(translatePlural('fr', 'status.devices', 1)).toBe('1 équipement')
    expect(translatePlural('fr', 'status.devices', 2)).toBe('2 équipements')
    expect(translatePlural('en', 'status.devices', 0)).toBe('0 devices')
    expect(translatePlural('en', 'status.devices', 1)).toBe('1 device')
  })
})
