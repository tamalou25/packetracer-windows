/**
 * Préférences de l'application (userData/settings.json) : thème de l'interface (Système par défaut).
 * Lues de façon synchrone au démarrage pour créer la fenêtre avec les bonnes couleurs.
 */
import { app } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { THEME_PREFERENCES, type Theme, type ThemePreference } from '../shared/ipc'
import { DEFAULT_SETTINGS, parseSettings, type Settings } from '../shared/persisted'

export type { Settings }

/** Couleur de fond de la fenêtre avant le premier rendu (identique au fond de l'application). */
export const THEME_BACKGROUND: Record<Theme, string> = { dark: '#0d0f13', light: '#eceef2' }

/** Préférence de thème reçue du renderer (Système, Sombre ou Clair). */
export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value)
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** Préférences enregistrées, validées par SettingsSchema (défauts si absentes ou invalides). */
export function loadSettings(): Settings {
  const path = settingsPath()
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS }
  try {
    return parseSettings(readFileSync(path, 'utf8'))
  } catch {
    // Fichier illisible : on repart des valeurs par défaut
    return { ...DEFAULT_SETTINGS }
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
