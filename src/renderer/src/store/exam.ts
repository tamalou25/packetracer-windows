/**
 * Mode examen : session en cours (chronomètre, sorties consignées) et résultat final.
 * Logique dans le moteur (labs/exam.ts) ; ce store ne fait que conserver l'état de l'interface.
 */
import { create } from 'zustand'
import type { ExamResult, ExamSession, LabDefinition } from '@engine/index'

interface ExamStore {
  session: ExamSession | null
  /** Lab de l'examen (conservé même si l'onglet Lab est fermé : la note porte dessus). */
  lab: LabDefinition | null
  /** Révision du document au début de l'examen : un autre document ouvert = abandon. */
  revision: number
  result: ExamResult | null
  set: (patch: Partial<Pick<ExamStore, 'session' | 'lab' | 'revision' | 'result'>>) => void
}

export const useExamStore = create<ExamStore>()((set) => ({
  session: null,
  lab: null,
  revision: 0,
  result: null,
  set: (patch) => set(patch)
}))
