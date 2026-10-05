/**
 * Validation des messages IPC reçus du renderer.
 * Le renderer est considéré comme non fiable : chaque argument est vérifié.
 */
import type { MenuState } from '../shared/ipc'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isMenuState(value: unknown): value is MenuState {
  return (
    isRecord(value) &&
    (value['mode'] === 'realtime' || value['mode'] === 'simulation') &&
    typeof value['showPortLabels'] === 'boolean' &&
    typeof value['showProperties'] === 'boolean'
  )
}

export function isDocState(value: unknown): value is { name: string; dirty: boolean } {
  return (
    isRecord(value) &&
    typeof value['name'] === 'string' &&
    value['name'].length <= 200 &&
    typeof value['dirty'] === 'boolean'
  )
}
