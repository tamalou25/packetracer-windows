/**
 * Bibliothèque de labs (process principal) : racine du dépôt, serveur local de test seulement,
 * chemins téléchargeables sur liste blanche.
 */
import { describe, expect, it } from 'vitest'
import { LIBRARY_FILE_PATTERN as ENGINE_PATTERN } from '../../src/engine/labs/library'
import {
  DEFAULT_LIBRARY_URL,
  LIBRARY_FILE_PATTERN,
  libraryBaseUrl,
  libraryFileUrl
} from '../../src/shared/library'

describe('bibliothèque : adresses', () => {
  it('dépôt public par défaut ; remplacement limité à un serveur local', () => {
    expect(DEFAULT_LIBRARY_URL).toMatch(/^https:\/\/raw\.githubusercontent\.com\//)
    expect(libraryBaseUrl(undefined)).toBe(DEFAULT_LIBRARY_URL)
    expect(libraryBaseUrl('http://127.0.0.1:8123/')).toBe('http://127.0.0.1:8123/')
    expect(libraryBaseUrl('http://localhost:9000/')).toBe('http://localhost:9000/')
    for (const other of [
      'https://exemple.fr/',
      'http://127.0.0.1.exemple.fr:80/',
      'file:///etc/',
      'http://10.0.0.1:80/'
    ])
      expect(libraryBaseUrl(other), other).toBe(DEFAULT_LIBRARY_URL)
  })

  it('seuls index.json et labs/<nom>.json sont téléchargeables', () => {
    const base = DEFAULT_LIBRARY_URL
    expect(libraryFileUrl(base, 'index.json')).toBe(`${base}index.json`)
    expect(libraryFileUrl(base, 'labs/dhcp-avance.json')).toBe(`${base}labs/dhcp-avance.json`)
    for (const file of ['../index.json', 'labs/../x.json', 'labs/a/b.json', 'README.md', 'labs/x.js', 42])
      expect(libraryFileUrl(base, file), String(file)).toBeNull()
  })

  it('même règle de chemin que le moteur', () => {
    expect(LIBRARY_FILE_PATTERN.source).toBe(ENGINE_PATTERN.source)
  })
})
