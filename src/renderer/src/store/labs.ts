/**
 * Lab pédagogique en cours : définition (énoncé, critères) et dernier résultat de vérification.
 */
import { create } from 'zustand'
import type { LabDefinition, LabProgress } from '@engine/index'

interface LabsStore {
  active: LabDefinition | null
  /** Résultat du dernier clic sur « Vérifier » (null : pas encore vérifié). */
  progress: LabProgress | null
  /** Sélecteur de lab ouvert (Fichier > Ouvrir un lab…). */
  pickerOpen: boolean
  /** Niveaux d'indice révélés par critère (0 : premier indice seulement). */
  hintLevels: Record<string, number>
  setActive: (lab: LabDefinition | null) => void
  revealHint: (criterionId: string) => void
  setProgress: (progress: LabProgress | null) => void
  setPickerOpen: (open: boolean) => void
}

export const useLabsStore = create<LabsStore>()((set) => ({
  active: null,
  progress: null,
  pickerOpen: false,
  hintLevels: {},
  setActive: (active) => set({ active, progress: null, hintLevels: {} }),
  revealHint: (id) => set((s) => ({ hintLevels: { ...s.hintLevels, [id]: (s.hintLevels[id] ?? 0) + 1 } })),
  setProgress: (progress) => set({ progress }),
  setPickerOpen: (pickerOpen) => set({ pickerOpen })
}))
