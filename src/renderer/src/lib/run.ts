/**
 * Exécute une action du moteur et affiche l'erreur éventuelle dans une notification.
 */
import type { EngineResult, LabState } from '@engine/index'
import { useLabStore } from '../store/lab'
import { useUiStore } from '../store/ui'

export function runAction<T>(
  action: (lab: LabState) => EngineResult<T>,
  options?: { undoable?: boolean; success?: string }
): T | undefined {
  const result = useLabStore.getState().run(action, options)
  if (!result.ok) {
    useUiStore.getState().notify('error', result.error.message)
    return undefined
  }
  if (options?.success) useUiStore.getState().notify('success', options.success)
  return result.value
}

/** Comme runAction, mais renvoie vrai en cas de succès (actions sans valeur de retour). */
export function runActionOk<T>(
  action: (lab: LabState) => EngineResult<T>,
  options?: { undoable?: boolean; success?: string }
): boolean {
  const result = useLabStore.getState().run(action, options)
  if (!result.ok) {
    useUiStore.getState().notify('error', result.error.message)
    return false
  }
  if (options?.success) useUiStore.getState().notify('success', options.success)
  return true
}
