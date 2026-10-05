/**
 * Données lues par le process principal (settings.json, recent.json, messages IPC) : un contenu
 * invalide donne les valeurs par défaut, jamais d'exception.
 */
import { describe, expect, it } from 'vitest'
import { MAX_SLAB_LENGTH } from '@engine/index'
import { MAX_SLAB_BYTES } from '../../src/shared/ipc'
import {
  DEFAULT_SETTINGS,
  DocStateSchema,
  MAX_MENU_LABEL,
  MAX_RECENT,
  MAX_RECENT_BYTES,
  MAX_SETTINGS_BYTES,
  MenuStateSchema,
  parseRecentFiles,
  parseSettings
} from '../../src/shared/persisted'

const recent = (n: number) => ({
  path: `C:\\Labs\\lab${n}.slab`,
  name: `lab${n}.slab`,
  openedAt: '2026-10-05T10:00:00Z'
})

describe('settings.json', () => {
  it('lit un thème valide et ignore les champs inconnus', () => {
    expect(parseSettings('{"theme":"light","fenetre":{"x":1}}')).toEqual({ theme: 'light' })
  })

  it('corrompu, tronqué, trop gros ou de mauvais type : préférences par défaut', () => {
    const cases = [
      '',
      '{"theme":"light"',
      'null',
      '[]',
      '"light"',
      '{"theme":42}',
      '{"theme":"rose"}',
      `{"theme":"light","x":"${'a'.repeat(MAX_SETTINGS_BYTES)}"}`
    ]
    for (const text of cases) expect(parseSettings(text), text.slice(0, 30)).toEqual(DEFAULT_SETTINGS)
  })
})

describe('recent.json', () => {
  it('garde les entrées valides, écarte les autres une à une', () => {
    const text = JSON.stringify([recent(1), { path: 42 }, null, recent(2), { ...recent(3), path: '' }, 'x'])
    expect(parseRecentFiles(text)).toEqual([recent(1), recent(2)])
  })

  it('retire les champs inconnus et limite le nombre d’entrées', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ...recent(i), pinned: true }))
    const files = parseRecentFiles(JSON.stringify(many))
    expect(files).toHaveLength(MAX_RECENT)
    expect(files.every((f) => !('pinned' in f))).toBe(true)
  })

  it('corrompu, tronqué, trop gros ou pas une liste : liste vide', () => {
    const big = JSON.stringify(Array.from({ length: 20_000 }, (_, i) => recent(i)))
    expect(big.length).toBeGreaterThan(MAX_RECENT_BYTES)
    for (const text of ['', '[{"path":', '{}', 'null', '"x"', big]) expect(parseRecentFiles(text)).toEqual([])
  })
})

describe('messages IPC', () => {
  it('état du menu : forme exacte exigée', () => {
    const ok = {
      mode: 'realtime',
      showPortLabels: false,
      showProperties: true,
      showMinimap: true,
      undoLabel: 'Annuler : Ajouter SRV1',
      redoLabel: null
    }
    expect(MenuStateSchema.safeParse(ok).success).toBe(true)
    expect(MenuStateSchema.safeParse({ ...ok, mode: 'turbo' }).success).toBe(false)
    expect(MenuStateSchema.safeParse({ ...ok, showMinimap: 'oui' }).success).toBe(false)
    expect(MenuStateSchema.safeParse(null).success).toBe(false)
  })

  it('état du menu : libellés Annuler / Rétablir texte court ou null', () => {
    const base = { mode: 'simulation', showPortLabels: true, showProperties: false, showMinimap: false }
    expect(MenuStateSchema.safeParse({ ...base, undoLabel: null, redoLabel: null }).success).toBe(true)
    expect(MenuStateSchema.safeParse({ ...base, undoLabel: null }).success).toBe(false)
    expect(MenuStateSchema.safeParse({ ...base, undoLabel: 42, redoLabel: null }).success).toBe(false)
    expect(
      MenuStateSchema.safeParse({ ...base, undoLabel: 'x'.repeat(MAX_MENU_LABEL + 1), redoLabel: null })
        .success
    ).toBe(false)
  })

  it('état du document : nom limité à 200 caractères', () => {
    expect(DocStateSchema.safeParse({ name: 'Lab 1', dirty: true }).success).toBe(true)
    expect(DocStateSchema.safeParse({ name: 'x'.repeat(201), dirty: true }).success).toBe(false)
    expect(DocStateSchema.safeParse({ name: 'Lab 1' }).success).toBe(false)
  })
})

it('la limite de taille des .slab est la même dans le moteur et le process principal', () => {
  expect(MAX_SLAB_LENGTH).toBe(MAX_SLAB_BYTES)
})
