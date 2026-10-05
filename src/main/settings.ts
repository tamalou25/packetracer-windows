/**
 * Préférences de l'application (userData/settings.json) : thème de l'interface.
 * Lues de façon synchrone au démarrage pour créer la fenêtre avec les bonnes couleurs.
 */
import { app } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { THEMES, type Theme } from '../shared/ipc'

export interface Settings {
  theme: Theme
}

const DEFAULTS: Settings = { theme: 'dark' }

/** Couleur de fond de la fenêtre avant le premier rendu (identique au fond de l'application). */
export const THEME_BACKGROUND: Record<Theme, string> = { dark: '#0d0f13', light: '#eceef2' }

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): Settings {
  const path = settingsPath()
  if (!existsSync(path)) return { ...DEFAULTS }
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const theme = (raw as { theme?: unknown } | null)?.theme
    return { theme: isTheme(theme) ? theme : DEFAULTS.theme }
  } catch {
    // Fichier illisible : on repart des valeurs par défaut
    return { ...DEFAULTS }
  }
}

/** Écriture atomique (fichier temporaire puis renommage). */
export function saveSettings(settings: Settings): void {
  const path = settingsPath()
  const tmp = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8')
    renameSync(tmp, path)
  } catch {
    // Préférence non enregistrée : sans conséquence pour la session en cours
  }
}
