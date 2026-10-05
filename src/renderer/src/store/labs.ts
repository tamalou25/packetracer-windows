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
  setActive: (lab: LabDefinition | null) => void
  setProgress: (progress: LabProgress | null) => void
  setPickerOpen: (open: boolean) => void
}

export const useLabsStore = create<LabsStore>()((set) => ({
  active: null,
  progress: null,
  pickerOpen: false,
  setActive: (active) => set({ active, progress: null }),
  setProgress: (progress) => set({ progress }),
  setPickerOpen: (pickerOpen) => set({ pickerOpen })
}))
