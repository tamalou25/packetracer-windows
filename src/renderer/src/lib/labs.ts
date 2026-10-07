/**
 * Labs pédagogiques : ouverture (état de départ construit par le moteur), vérification des
 * critères, reprise depuis le départ.
 */
import { buildLabStart, checkLab, type LabDefinition } from '@engine/index'
import { useExamStore } from '../store/exam'
import { useLabStore } from '../store/lab'
import { useLabsStore } from '../store/labs'
import { useUiStore } from '../store/ui'
import { confirmDiscard, resetDocumentUi } from './document'

/** Ouvre un lab : nouvel état de départ (document sans fichier) et onglet Lab affiché. */
export async function openLab(lab: LabDefinition): Promise<boolean> {
  if (!(await confirmDiscard())) return false
  let start
  try {
    start = buildLabStart(lab.start)
  } catch (e) {
    useUiStore.getState().showModal({
      title: 'Ouverture du lab impossible',
      message: e instanceof Error ? e.message : String(e)
    })
    return false
  }
  // Résultat d'un examen précédent effacé ; un examen en cours est noté comme abandonné au
  // chargement du nouveau lab (son résultat reste affiché)
  useExamStore.getState().set({ result: null })
  resetDocumentUi()
  useLabStore.getState().load(start, { path: null, name: `${lab.id}.slab` })
  useLabsStore.getState().setActive(lab)
  useLabsStore.getState().setPickerOpen(false)
  useUiStore.getState().setRightTab('lab')
  return true
}

/** Vérifie les critères du lab en cours sur l'état actuel. */
export function verifyLab(): void {
  const lab = useLabsStore.getState().active
  if (!lab) return
  const progress = checkLab(useLabStore.getState().lab, lab)
  useLabsStore.getState().setProgress(progress)
  if (progress.passed === progress.total)
    useUiStore
      .getState()
      .notify('success', `Lab réussi : ${progress.total} critère(s) sur ${progress.total} validé(s).`)
}

/** Recommence le lab : l'état de départ est reconstruit (les modifications sont perdues). */
export function restartLab(): void {
  const lab = useLabsStore.getState().active
  if (!lab) return
  useUiStore.getState().showModal({
    title: 'Recommencer le lab',
    message: `Toutes les modifications faites dans « ${lab.title} » seront perdues. Continuer ?`,
    confirmLabel: 'Recommencer',
    onConfirm: () => {
      resetDocumentUi()
      useLabStore.getState().load(buildLabStart(lab.start), { path: null, name: `${lab.id}.slab` })
      useLabsStore.getState().setActive(lab)
      useUiStore.getState().setRightTab('lab')
    }
  })
}
