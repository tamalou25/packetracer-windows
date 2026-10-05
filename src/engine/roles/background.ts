/**
 * Tâches de fond des rôles (mode Temps réel) : le moteur les exécute dans l'ordre du registre
 * (bail DHCP avant application des stratégies de groupe), comme sur de vrais ordinateurs.
 */
import type { LabState } from '../model/schema'
import type { PacketTrace } from '../sim/trace'
import { roleBackgroundTasks } from './registry'

export function runBackgroundTasks(state: LabState): { state: LabState; traces: PacketTrace[] } {
  let current = state
  const traces: PacketTrace[] = []
  for (const task of roleBackgroundTasks()) {
    const result = task.run(current)
    current = result.state
    traces.push(...result.traces)
  }
  return { state: current, traces }
}

/** Libellé du passage des tâches de fond (journal). */
export function backgroundLabel(): string {
  return `Tâches de fond (${roleBackgroundTasks()
    .map((t) => t.label)
    .join(', ')})`
}
