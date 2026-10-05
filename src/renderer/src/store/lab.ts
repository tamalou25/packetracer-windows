/**
 * Store du document courant : état simulé (LabState du moteur), journal des commandes, fichier.
 * Toute modification passe par `dispatch` (commande nommée du moteur) ; l'annuler/rétablir
 * applique les patches du journal, sans aucun inverse écrit à la main.
 */
import { create } from 'zustand'
import {
  applyStatePatches,
  createLab,
  dispatch as dispatchCommand,
  journalEntry,
  type AnyCommand,
  type Command,
  type CommandType,
  type CommandValue,
  type DispatchResult,
  type JournalEntry,
  type LabState,
  type Viewport
} from '@engine/index'

const HISTORY_LIMIT = 100
export const UNTITLED = 'Sans titre'

type LabelledCommand = AnyCommand & { label?: string }

/** Commande déjà exécutée sur un état de base, validée plus tard (fin de lecture en Simulation). */
export interface PreparedCommand<T = unknown> {
  command: LabelledCommand
  base: LabState
  result: DispatchResult<T>
}

export interface DispatchOptions {
  /** false : appliquée sans entrer dans l'historique (tâches de fond). */
  record?: boolean
}

interface LabStore {
  lab: LabState
  filePath: string | null
  fileName: string
  dirty: boolean
  /** Commandes annulables, la plus récente en dernier. */
  journal: JournalEntry[]
  /** Commandes annulées, prêtes à être rétablies (la prochaine en dernier). */
  redoStack: JournalEntry[]
  /** État au début d'une transaction (glisser) : les commandes intermédiaires ne sont pas journalisées. */
  transactionBase: LabState | null
  /** Incrémenté à chaque chargement de document (permet au canvas de recadrer la vue). */
  revision: number
  /** Vue à restaurer après chargement (null → ajuster à la fenêtre). */
  viewport: Viewport | null

  /** Exécute une commande du moteur ; en cas de succès l'état est remplacé (et journalisé). */
  dispatch<K extends CommandType>(
    command: Command<K>,
    options?: DispatchOptions
  ): DispatchResult<CommandValue<K>>
  dispatch(command: LabelledCommand, options?: DispatchOptions): DispatchResult<unknown>
  /** Exécute une commande sans l'appliquer (opération réseau rejouée avant validation). */
  prepare<K extends CommandType>(command: Command<K>): PreparedCommand<CommandValue<K>>
  /** Valide une commande préparée ; si le lab a changé entre-temps, elle est exécutée à nouveau. */
  commit(prepared: PreparedCommand): void
  /** Ouvre une transaction : la suite de modifications forme une seule entrée du journal. */
  beginTransaction(): void
  /** Ferme la transaction et la journalise sous la commande qui la résume (ex. déplacement). */
  commitTransaction(command: LabelledCommand): void
  undo(): boolean
  redo(): boolean
  /** Remplace le document (nouveau, ouverture, récupération). */
  load(
    lab: LabState,
    file: { path: string | null; name: string },
    viewport?: Viewport | null,
    dirty?: boolean
  ): void
  markSaved(path: string, name: string): void
}

/** Ajoute une entrée au journal (la pile de rétablissement est vidée). */
function pushEntry(journal: JournalEntry[], entry: JournalEntry): Pick<LabStore, 'journal' | 'redoStack'> {
  return { journal: [...journal, entry].slice(-HISTORY_LIMIT), redoStack: [] }
}

export const useLabStore = create<LabStore>()((set, get) => ({
  lab: createLab(),
  filePath: null,
  fileName: UNTITLED,
  dirty: false,
  journal: [],
  redoStack: [],
  transactionBase: null,
  revision: 0,
  viewport: null,

  dispatch: ((command: LabelledCommand, options?: DispatchOptions) => {
    const before = get().lab
    const result = dispatchCommand(before, command)
    if (result.ok && result.state !== before) {
      const record = (options?.record ?? true) && get().transactionBase === null
      set((s) => ({
        lab: result.state,
        dirty: true,
        ...(record && result.entry ? pushEntry(s.journal, result.entry) : {})
      }))
    }
    return result
  }) as LabStore['dispatch'],

  prepare: ((command: LabelledCommand) => {
    const base = get().lab
    return { command, base, result: dispatchCommand(base, command) }
  }) as LabStore['prepare'],

  commit(prepared) {
    const { result, base, command } = prepared
    if (!result.ok) return
    if (get().lab !== base) {
      // Le lab a changé pendant la lecture : la commande est rejouée sur l'état courant
      get().dispatch(command)
      return
    }
    if (result.state === base) return
    const entry = journalEntry(base, result.state, command)
    set((s) => ({ lab: result.state, dirty: true, ...(entry ? pushEntry(s.journal, entry) : {}) }))
  },

  beginTransaction() {
    if (get().transactionBase === null) set({ transactionBase: get().lab })
  },

  commitTransaction(command) {
    const base = get().transactionBase
    if (base === null) return
    const entry = journalEntry(base, get().lab, command)
    set((s) => ({ transactionBase: null, ...(entry ? pushEntry(s.journal, entry) : {}) }))
  },

  undo() {
    const { journal, redoStack, lab } = get()
    const entry = journal[journal.length - 1]
    if (!entry) return false
    try {
      set({
        lab: applyStatePatches(lab, entry.inversePatches),
        journal: journal.slice(0, -1),
        redoStack: [...redoStack, entry],
        dirty: true
      })
      return true
    } catch {
      // Patches devenus inapplicables (objet supprimé depuis par une tâche de fond) : entrée écartée
      set({ journal: journal.slice(0, -1) })
      return false
    }
  },

  redo() {
    const { journal, redoStack, lab } = get()
    const entry = redoStack[redoStack.length - 1]
    if (!entry) return false
    try {
      set({
        lab: applyStatePatches(lab, entry.patches),
        journal: [...journal, entry],
        redoStack: redoStack.slice(0, -1),
        dirty: true
      })
      return true
    } catch {
      set({ redoStack: redoStack.slice(0, -1) })
      return false
    }
  },

  load(lab, file, viewport = null, dirty = false) {
    set((s) => ({
      lab,
      filePath: file.path,
      fileName: file.name,
      dirty,
      journal: [],
      redoStack: [],
      transactionBase: null,
      viewport,
      revision: s.revision + 1
    }))
  },

  markSaved(path, name) {
    set({ filePath: path, fileName: name, dirty: false })
  }
}))
