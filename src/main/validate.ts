/**
 * Validation des messages IPC reçus du renderer (schémas zod de shared/persisted.ts).
 * Le renderer est considéré comme non fiable : chaque argument est vérifié.
 */
import type { MenuState } from '../shared/ipc'
import { DocStateSchema, MenuStateSchema } from '../shared/persisted'

export function isMenuState(value: unknown): value is MenuState {
  return MenuStateSchema.safeParse(value).success
}

export function isDocState(value: unknown): value is { name: string; dirty: boolean } {
  return DocStateSchema.safeParse(value).success
}
