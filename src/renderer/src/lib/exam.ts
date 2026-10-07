/**
 * Mode examen : départ du lab reconstruit, indices désactivés, vérification finale unique.
 * Les sorties (application quittée, lab fermé, autre document, temps écoulé) sont consignées
 * par le moteur (labs/exam.ts) et figurent dans le résultat.
 */
import { useEffect } from 'react'
import {
  buildLabStart,
  durationMinutes,
  examResultText,
  finishExam,
  recordExamEvent,
  remainingMs,
  startExam,
  type ExamResult,
  type LabState
} from '@engine/index'
import { useExamStore } from '../store/exam'
import { useLabStore } from '../store/lab'
import { useLabsStore } from '../store/labs'
import { useUiStore } from '../store/ui'
import { resetDocumentUi } from './document'

/** Propose de démarrer l'examen sur le lab en cours (départ reconstruit). */
export function askStartExam(): void {
  const lab = useLabsStore.getState().active
  if (!lab) return
  const minutes = durationMinutes(lab.duration)
  useUiStore.getState().showModal({
    title: 'Démarrer l’examen',
    message: `Le lab repart de son état de départ (les modifications en cours sont perdues). Vous disposez de ${minutes} min ; les indices sont désactivés et la vérification finale est unique. Toute sortie de l’application est signalée dans le résultat.`,
    confirmLabel: 'Démarrer',
    onConfirm: () => {
      resetDocumentUi()
      useLabStore.getState().load(buildLabStart(lab.start), { path: null, name: `${lab.id}.slab` })
      useLabsStore.getState().setActive(lab)
      useUiStore.getState().setRightTab('lab')
      useExamStore.getState().set({
        session: startExam(lab, Date.now(), minutes),
        lab,
        revision: useLabStore.getState().revision,
        result: null
      })
    }
  })
}

/**
 * Vérification finale (ou fin imposée : temps écoulé, abandon) sur l'état donné (par défaut,
 * l'état actuel du lab).
 */
export function endExam(
  ending: ExamResult['ending'] = 'finish',
  state: LabState = useLabStore.getState().lab
): void {
  const { session, lab } = useExamStore.getState()
  if (!session || !lab) return
  const result = finishExam(session, state, lab, Date.now(), ending)
  useExamStore.getState().set({ session: null, result })
}

export function askFinishExam(): void {
  useUiStore.getState().showModal({
    title: 'Terminer l’examen',
    message: 'La vérification finale est unique : vos réponses ne pourront plus être modifiées.',
    confirmLabel: 'Terminer',
    onConfirm: () => endExam('finish')
  })
}

const formatTime = (at: number) =>
  new Date(at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })

export async function exportExamResult(): Promise<void> {
  const { result } = useExamStore.getState()
  if (!result) return
  const res = await window.serverlab.exportExamResult(
    examResultText(result, formatTime),
    `Examen - ${result.labId}`
  )
  const ui = useUiStore.getState()
  if (res.ok) ui.notify('success', `Résultat enregistré : ${res.value}`)
  else if (!res.canceled)
    ui.showModal({ title: 'Export impossible', message: res.error ?? 'Erreur inconnue.' })
}

/**
 * Garde-fous de l'examen (monté une fois) : perte et retour du focus de la fenêtre, temps écoulé,
 * lab fermé ou autre document ouvert (abandon).
 */
export function useExamGuards(): void {
  const running = useExamStore((s) => s.session !== null)
  useEffect(() => {
    if (!running) return
    const record = (type: 'leave' | 'return') => {
      const { session } = useExamStore.getState()
      if (session) useExamStore.getState().set({ session: recordExamEvent(session, type, Date.now()) })
    }
    const onBlur = () => record('leave')
    const onFocus = () => record('return')
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(() => {
      const { session } = useExamStore.getState()
      if (session && remainingMs(session, Date.now()) === 0) endExam('timeout')
    }, 1000)
    // Lab fermé : abandon noté sur l'état actuel
    const unsubLabs = useLabsStore.subscribe((s) => {
      const { session } = useExamStore.getState()
      if (session && s.active?.id !== session.labId) endExam('abandon')
    })
    // Autre document ouvert : abandon noté sur l'état d'avant le changement
    const unsubDoc = useLabStore.subscribe((s, prev) => {
      const { session, revision } = useExamStore.getState()
      if (session && s.revision !== revision) endExam('abandon', prev.lab)
    })
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
      unsubLabs()
      unsubDoc()
    }
  }, [running])
}
