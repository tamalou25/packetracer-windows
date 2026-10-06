/**
 * Exécute une commande du moteur et affiche l'erreur éventuelle dans une notification.
 */
import type { AnyCommand, Command, CommandType, CommandValue } from '@engine/index'
import { useLabStore } from '../store/lab'
import { useUiStore } from '../store/ui'

interface RunOptions {
  /** Notification affichée en cas de succès. */
  success?: string
}

/** Exécute la commande ; renvoie sa valeur, ou undefined en cas d'erreur (notifiée). */
export function runCommand<K extends CommandType>(
  command: Command<K>,
  options?: RunOptions
): CommandValue<K> | undefined
export function runCommand(command: AnyCommand & { label?: string }, options?: RunOptions): unknown
export function runCommand(command: AnyCommand & { label?: string }, options?: RunOptions): unknown {
  const result = useLabStore.getState().dispatch(command)
  if (!result.ok) {
    useUiStore.getState().notify('error', result.error.message)
    return undefined
  }
  if (options?.success) useUiStore.getState().notify('success', options.success)
  return result.value
}

/** Comme runCommand, mais renvoie vrai en cas de succès (commandes sans valeur de retour). */
export function runCommandOk(command: AnyCommand & { label?: string }, options?: RunOptions): boolean {
  const result = useLabStore.getState().dispatch(command)
  if (!result.ok) {
    useUiStore.getState().notify('error', result.error.message)
    return false
  }
  if (options?.success) useUiStore.getState().notify('success', options.success)
  return true
}
