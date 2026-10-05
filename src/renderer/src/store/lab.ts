/**
 * Store du document courant : état simulé (LabState du moteur), historique, fichier.
 * Toute modification passe par `run`, qui applique une action pure du moteur.
 */
import { create } from 'zustand'
import { createLab, type EngineResult, type LabState, type Viewport } from '@engine/index'

const HISTORY_LIMIT = 100
export const UNTITLED = 'Sans titre'

interface LabStore {
  lab: LabState
  filePath: string | null
  fileName: string
  dirty: boolean
  past: LabState[]
  future: LabState[]
  /** Incrémenté à chaque chargement de document (permet au canvas de recadrer la vue). */
  revision: number
  /** Vue à restaurer après chargement (null → ajuster à la fenêtre). */
  viewport: Viewport | null

  /** Applique une action du moteur ; en cas de succès l'état est remplacé (et historisé). */
  run<T>(action: (lab: LabState) => EngineResult<T>, options?: { undoable?: boolean }): EngineResult<T>
  /** Mémorise l'état courant dans l'historique (avant une suite de modifications transitoires). */
  checkpoint(): void
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

export const useLabStore = create<LabStore>()((set, get) => ({
  lab: createLab(),
  filePath: null,
  fileName: UNTITLED,
  dirty: false,
  past: [],
  future: [],
  revision: 0,
  viewport: null,

  run(action, options) {
    const before = get().lab
    const result = action(before)
    if (result.ok && result.state !== before) {
      const undoable = options?.undoable ?? true
      set((s) => ({
        lab: result.state,
        dirty: true,
        past: undoable ? [...s.past, before].slice(-HISTORY_LIMIT) : s.past,
        future: undoable ? [] : s.future
      }))
    }
    return result
  },

  checkpoint() {
    set((s) => ({ past: [...s.past, s.lab].slice(-HISTORY_LIMIT), future: [] }))
  },

  undo() {
    const { past, lab, future } = get()
    const previous = past[past.length - 1]
    if (!previous) return false
    set({ lab: previous, past: past.slice(0, -1), future: [lab, ...future], dirty: true })
    return true
  },

  redo() {
    const { past, lab, future } = get()
    const next = future[0]
    if (!next) return false
    set({ lab: next, past: [...past, lab], future: future.slice(1), dirty: true })
    return true
  },

  load(lab, file, viewport = null, dirty = false) {
    set((s) => ({
      lab,
      filePath: file.path,
      fileName: file.name,
      dirty,
      past: [],
      future: [],
      viewport,
      revision: s.revision + 1
    }))
  },

  markSaved(path, name) {
    set({ filePath: path, fileName: name, dirty: false })
  }
}))
