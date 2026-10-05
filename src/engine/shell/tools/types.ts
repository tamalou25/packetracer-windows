/**
 * Outils en ligne de commande (ipconfig, ping…) utilisables depuis les deux consoles.
 */
import type { ExecContext } from '../context'

export interface ToolDef {
  /** Nom de l'exécutable (sans .exe). */
  name: string
  synopsis: string
  /** Options proposées par la complétion Tab. */
  switches?: string[]
  available?: (ctx: ExecContext) => boolean
  run: (ctx: ExecContext, args: string[]) => void
}
