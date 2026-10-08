/**
 * Thème appliqué selon la préférence, et catalogue unique des raccourcis (menu et aide).
 */
import { describe, expect, it } from 'vitest'
import { THEME_PREFERENCES } from '../../src/shared/ipc'
import {
  accelerator,
  formatShortcut,
  SHORTCUT_GROUPS,
  shortcutGroupLabel,
  shortcutLabel,
  SHORTCUTS,
  type Shortcut
} from '../../src/shared/shortcuts'
import { resolveTheme } from '../../src/shared/theme'

describe('thème', () => {
  it('Système suit l’OS, Sombre et Clair l’ignorent', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
    expect(THEME_PREFERENCES).toEqual(['system', 'dark', 'light'])
  })
})

describe('raccourcis clavier', () => {
  const all = Object.values(SHORTCUTS) as Shortcut[]

  it('chaque touche n’appartient qu’à un raccourci', () => {
    const keys = all.flatMap((s) => s.keys.map((k) => k.toLowerCase()))
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([])
  })

  it('touches au format des accélérateurs, groupes connus', () => {
    const modifier = /^(CmdOrCtrl|Shift|Alt)$/
    for (const s of all) {
      expect(SHORTCUT_GROUPS).toContain(s.group)
      for (const key of s.keys) {
        const parts = key.split('+')
        const last = parts.pop() ?? ''
        for (const part of parts) expect(part, key).toMatch(modifier)
        expect(last, key).toMatch(/^([A-Z0-9=-]|F\d{1,2}|Delete|Escape)$/)
      }
    }
  })

  it('format selon la langue et accélérateur du menu', () => {
    expect(formatShortcut('CmdOrCtrl+Shift+S', 'fr')).toBe('Ctrl+Maj+S')
    expect(formatShortcut('Delete', 'fr')).toBe('Suppr')
    expect(formatShortcut('Escape', 'fr')).toBe('Échap')
    expect(formatShortcut('F6', 'fr')).toBe('F6')
    expect(formatShortcut('CmdOrCtrl+Shift+S', 'en')).toBe('Ctrl+Shift+S')
    expect(formatShortcut('Delete', 'en')).toBe('Del')
    expect(shortcutLabel('toolCable', 'fr')).toBe('Outil Câble')
    expect(shortcutLabel('toolCable', 'en')).toBe('Cable tool')
    expect(shortcutGroupLabel('tools', 'en')).toBe('Canvas tools')
    expect(accelerator('redo')).toBe('CmdOrCtrl+Y')
    expect(SHORTCUTS.redo.keys).toContain('CmdOrCtrl+Shift+Z')
  })
})
