/**
 * Tâches de fond des rôles (mode Temps réel) : le moteur les exécute dans l'ordre du registre
 * (bail DHCP avant application des stratégies de groupe), comme sur de vrais ordinateurs.
 * Incrémentales : une tâche qui déclare ses dépendances n'est relancée que si elles ont changé
 * depuis son dernier passage (mémo transmis d'un appel au suivant).
 */
import type { LabState } from '../model/schema'
import type { PacketTrace } from '../sim/trace'
import { IOS_BACKGROUND_TASK } from '../ios/registry'
import { roleBackgroundTasks } from './registry'

/** Dépendances de chaque tâche lors de son dernier passage (par identifiant de tâche). */
export type BackgroundMemo = Readonly<Record<string, readonly unknown[]>>

export interface BackgroundRun {
  state: LabState
  traces: PacketTrace[]
  /** Mémo à transmettre au prochain appel. */
  memo: BackgroundMemo
  /** Tâches effectivement exécutées. */
  ran: string[]
}

function sameDeps(a: readonly unknown[] | undefined, b: readonly unknown[]): boolean {
  return !!a && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
}

/** Exécute les tâches dont les dépendances ont changé (toutes, sans mémo). */
export function runBackgroundTasks(state: LabState, memo: BackgroundMemo = {}): BackgroundRun {
  let current = state
  const traces: PacketTrace[] = []
  const next: Record<string, readonly unknown[]> = { ...memo }
  const ran: string[] = []
  for (const task of [...roleBackgroundTasks(), IOS_BACKGROUND_TASK]) {
    if (task.deps && sameDeps(memo[task.id], task.deps(current))) continue
    const result = task.run(current)
    current = result.state
    traces.push(...result.traces)
    ran.push(task.id)
    // Dépendances après son propre passage : son résultat ne la relance pas
    if (task.deps) next[task.id] = task.deps(current)
  }
  return { state: current, traces, memo: next, ran }
}

/** Libellé du passage des tâches de fond (journal). */
export function backgroundLabel(): string {
  return `Tâches de fond (${[...roleBackgroundTasks(), IOS_BACKGROUND_TASK].map((t) => t.label).join(', ')})`
}
