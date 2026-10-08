/**
 * Historique annuler / rétablir : deux piles d'entrées du journal des commandes. Annuler applique
 * les patches inverses de l'entrée, rétablir ses patches (calculés par `dispatch`) : aucun inverse
 * n'est écrit à la main. Les tâches de fond ne passent pas par l'historique : annuler une action
 * ne défait pas un bail DHCP obtenu entre-temps.
 */
import type { EngineError } from '../core/result'
import type { LabState } from '../model/schema'
import type { JournalEntry } from './dispatch'
import { applyStatePatches } from './patches'

/** Nombre d'entrées conservées (les plus anciennes sont oubliées au-delà). */
export const HISTORY_LIMIT = 100

export interface History {
  /** Commandes annulables, la plus récente en dernier. */
  past: JournalEntry[]
  /** Commandes annulées, prêtes à être rétablies (la prochaine en dernier). */
  future: JournalEntry[]
}

export type HistoryStep =
  | { ok: true; state: LabState; history: History; entry: JournalEntry }
  | { ok: false; history: History; error: EngineError }

export function emptyHistory(): History {
  return { past: [], future: [] }
}

/** Ajoute une commande exécutée : la pile de rétablissement est vidée. */
export function recordEntry(history: History, entry: JournalEntry, limit = HISTORY_LIMIT): History {
  return { past: [...history.past, entry].slice(-limit), future: [] }
}

/** Annule la dernière commande. */
export function undoStep(state: LabState, history: History): HistoryStep {
  const entry = history.past[history.past.length - 1]
  if (!entry) return { ok: false, history, error: { code: 'NothingToUndo', message: 'Rien à annuler.' } }
  const past = history.past.slice(0, -1)
  try {
    return {
      ok: true,
      state: applyStatePatches(state, entry.inversePatches),
      history: { past, future: [...history.future, entry] },
      entry
    }
  } catch {
    // Patches devenus inapplicables (objet supprimé depuis par une tâche de fond) : entrée écartée
    return {
      ok: false,
      history: { past, future: history.future },
      error: {
        code: 'UndoNotApplicable',
        message: `Impossible d’annuler « ${entry.label} » : le lab a changé depuis.`
      }
    }
  }
}

/** Rétablit la dernière commande annulée. */
export function redoStep(state: LabState, history: History): HistoryStep {
  const entry = history.future[history.future.length - 1]
  if (!entry) return { ok: false, history, error: { code: 'NothingToRedo', message: 'Rien à rétablir.' } }
  const future = history.future.slice(0, -1)
  try {
    return {
      ok: true,
      state: applyStatePatches(state, entry.patches),
      history: { past: [...history.past, entry], future },
      entry
    }
  } catch {
    return {
      ok: false,
      history: { past: history.past, future },
      error: {
        code: 'RedoNotApplicable',
        message: `Impossible de rétablir « ${entry.label} » : le lab a changé depuis.`
      }
    }
  }
}

/** Libellés des prochaines commandes à annuler et à rétablir (null : pile vide). */
export function historyLabels(history: History): { undo: string | null; redo: string | null } {
  return {
    undo: history.past[history.past.length - 1]?.label ?? null,
    redo: history.future[history.future.length - 1]?.label ?? null
  }
}

/** Longueur maximale d'un libellé dans le menu Édition. */
export const MENU_LABEL_MAX = 60

/** Libellé de commande tronqué pour le menu Édition (« … » final au-delà de `max` caractères). */
export function truncateMenuLabel(label: string, max = MENU_LABEL_MAX): string {
  return label.length > max ? `${label.slice(0, max - 1).trimEnd()}…` : label
}

/** Libellé d'un élément de menu : « Annuler : Ajouter SRV1 », tronqué au besoin. */
export function menuLabel(action: string, label: string | null, max = MENU_LABEL_MAX): string {
  if (!label) return action
  return `${action} : ${truncateMenuLabel(label, max)}`
}
