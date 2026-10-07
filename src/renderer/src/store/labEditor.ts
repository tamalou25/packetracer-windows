/**
 * Éditeur de labs : brouillon en cours (énoncé, critères, indices) et topologie de départ capturée
 * sur le lab courant. Le brouillon survit à la fermeture de l'éditeur pendant la session.
 */
import { create } from 'zustand'
import type { Check, LabDraft, LabState } from '@engine/index'

export interface DraftCriterion {
  /** Identifiant local (clé React), stable pendant l'édition. */
  key: number
  label: string
  hints: string[]
  type: string
  values: Record<string, string | boolean | string[] | undefined>
  /** Dernier test sur le lab courant (null : pas encore testé). */
  tested: boolean | null
  check: Check | null
}

export type EditorDraft = Omit<LabDraft, 'criteria'> & { criteria: DraftCriterion[] }

export const EMPTY_DRAFT: EditorDraft = {
  title: '',
  difficulty: 'Débutant',
  duration: '30 min',
  summary: '',
  statement: '',
  criteria: []
}

interface LabEditorStore {
  open: boolean
  draft: EditorDraft
  /** Départ capturé (instantané du lab courant), null tant qu'aucun départ n'est choisi. */
  start: LabState | null
  setOpen: (open: boolean) => void
  update: (patch: Partial<EditorDraft>) => void
  setCriterion: (key: number, patch: Partial<DraftCriterion>) => void
  setStart: (start: LabState | null) => void
  reset: (draft: EditorDraft, start: LabState | null) => void
}

export const useLabEditorStore = create<LabEditorStore>()((set) => ({
  open: false,
  draft: EMPTY_DRAFT,
  start: null,
  setOpen: (open) => set({ open }),
  update: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
  setCriterion: (key, patch) =>
    set((s) => ({
      draft: {
        ...s.draft,
        criteria: s.draft.criteria.map((c) => (c.key === key ? { ...c, ...patch } : c))
      }
    })),
  setStart: (start) => set({ start }),
  reset: (draft, start) => set({ draft, start })
}))
