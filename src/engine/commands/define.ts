/**
 * Définition d'une commande nommée : action pure du moteur + libellé français.
 * Utilisé par le catalogue du cœur (`catalog.ts`) et par les commandes de chaque rôle
 * (`roles/<rôle>/commands.ts`).
 */
import type { EngineResult } from '../core/result'
import type { LabState } from '../model/schema'
import { deviceName } from './labels'

/** Définition d'une commande : action du moteur et libellé. */
export interface CommandDef<A extends unknown[], T> {
  // Syntaxe de méthode : les définitions typées restent assignables au type générique du registre
  run(state: LabState, ...args: A): EngineResult<T>
  label(state: LabState, ...args: A): string
}

/** Ensemble de commandes nommées (« dhcp.addScope » → définition). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CommandDefs = Record<string, CommandDef<any, any>>

export function def<A extends unknown[], T>(
  run: (state: LabState, ...args: A) => EngineResult<T>,
  // Arguments déduits de l'action seule (le libellé peut ignorer les derniers)
  label: NoInfer<(state: LabState, ...args: A) => string>
): CommandDef<A, T> {
  return { run, label }
}

/** Commande sans typage précis (sous-commandes d'un lot, commandes relues d'un fichier). */
export interface AnyCommand {
  type: string
  args: unknown[]
}

/** Suffixe « sur SRV1 » des libellés. */
export const on = (s: LabState, id: string): string => ` sur ${deviceName(s, id)}`
