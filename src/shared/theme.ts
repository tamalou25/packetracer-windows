/**
 * Thème de l'interface : préférence enregistrée (Système, Sombre, Clair) et thème appliqué.
 */
import type { Theme, ThemePreference } from './ipc'

/** Thème appliqué : celui de l'OS en mode Système, sinon le choix explicite. */
export function resolveTheme(preference: ThemePreference, systemDark: boolean): Theme {
  if (preference === 'system') return systemDark ? 'dark' : 'light'
  return preference
}
