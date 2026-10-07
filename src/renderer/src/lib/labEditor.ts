/**
 * Éditeur de labs : actions de l'interface (logique dans le moteur : labs/editor.ts).
 * Départ capturé sur le lab courant, critères testés sur le lab courant, export / import JSON par
 * dialogues natifs, essai du lab comme un lab fourni.
 */
import {
  buildCheck,
  buildLabStart,
  checkValues,
  createLabDefinition,
  draftFromLab,
  parseLabText,
  serializeLab,
  testCheck,
  type LabDefinition,
  type LabDefinitionResult
} from '@engine/index'
import { useLabEditorStore, type DraftCriterion, type EditorDraft } from '../store/labEditor'
import { useLabStore } from '../store/lab'
import { useLabsStore } from '../store/labs'
import { useUiStore } from '../store/ui'
import { openLab } from './labs'
import { t } from './i18n'

let nextKey = 1

/** Ouvre l'éditeur ; sans départ capturé, le lab courant devient la topologie de départ. */
export function openLabEditor(): void {
  const editor = useLabEditorStore.getState()
  if (!editor.start) editor.setStart(useLabStore.getState().lab)
  useLabsStore.getState().setPickerOpen(false)
  editor.setOpen(true)
}

/** Remplace la topologie de départ par l'état actuel du lab. */
export function captureStart(): void {
  useLabEditorStore.getState().setStart(useLabStore.getState().lab)
  useUiStore.getState().notify('success', t('editor.captured'))
}

export function addCriterion(type: string): void {
  const { draft, update } = useLabEditorStore.getState()
  const criterion: DraftCriterion = {
    key: nextKey++,
    label: '',
    hints: [''],
    type,
    values: {},
    tested: null,
    check: null
  }
  update({ criteria: [...draft.criteria, criterion] })
}

export function removeCriterion(key: number): void {
  const { draft, update } = useLabEditorStore.getState()
  update({ criteria: draft.criteria.filter((c) => c.key !== key) })
}

/** Change le type d'un critère : valeurs remises à zéro. */
export function setCriterionType(key: number, type: string): void {
  useLabEditorStore.getState().setCriterion(key, { type, values: {}, check: null, tested: null })
}

/** Nouvelle valeur d'un champ : la vérification est reconstruite (null si incomplète). */
export function setCriterionValue(key: number, field: string, value: string | boolean | string[]): void {
  const criterion = useLabEditorStore.getState().draft.criteria.find((c) => c.key === key)
  if (!criterion) return
  const values = { ...criterion.values, [field]: value }
  const built = buildCheck(criterion.type, values)
  useLabEditorStore
    .getState()
    .setCriterion(key, { values, check: built.ok ? built.check : null, tested: null })
}

/** Message d'erreur du critère tel qu'il est saisi (null s'il est complet). */
export function criterionError(criterion: DraftCriterion): string | null {
  const built = buildCheck(criterion.type, criterion.values)
  return built.ok ? null : built.message
}

/** Teste un critère (ou tous) sur l'état actuel du lab. */
export function testCriteria(key?: number): void {
  const { draft, setCriterion } = useLabEditorStore.getState()
  const lab = useLabStore.getState().lab
  for (const c of draft.criteria)
    if (key === undefined || c.key === key)
      setCriterion(c.key, { tested: c.check ? testCheck(lab, c.check) : null })
}

/** Définition complète du brouillon (départ capturé) ou message d'erreur. */
export function currentDefinition(): LabDefinitionResult {
  const { draft, start } = useLabEditorStore.getState()
  if (!start) return { ok: false, message: t('editor.captureFirst') }
  const incomplete = draft.criteria.findIndex((c) => !c.check)
  if (incomplete >= 0) {
    const c = draft.criteria[incomplete]!
    return {
      ok: false,
      message: t('editor.criterionError', {
        index: incomplete + 1,
        error: criterionError(c) ?? t('editor.incomplete')
      })
    }
  }
  return createLabDefinition(
    { ...draft, criteria: draft.criteria.map((c) => ({ label: c.label, hints: c.hints, check: c.check! })) },
    start,
    { appVersion: useUiStore.getState().appVersion, savedAt: new Date().toISOString() }
  )
}

function showError(title: string, message: string): void {
  useUiStore.getState().showModal({ title, message })
}

/** Exporte le lab en JSON (dialogue « Enregistrer sous »). */
export async function exportDraft(): Promise<void> {
  const def = currentDefinition()
  if (!def.ok) return showError(t('editor.exportFailed'), def.message)
  const res = await window.serverlab.exportLab(serializeLab(def.lab), def.lab.id)
  if (res.ok) useUiStore.getState().notify('success', t('editor.exported', { path: res.value }))
  else if (!res.canceled) showError(t('editor.exportFailed'), res.error ?? t('error.unknown'))
}

/** Ouvre le brouillon comme un lab (départ reconstruit, onglet Lab). */
export async function tryDraft(): Promise<void> {
  const def = currentDefinition()
  if (!def.ok) return showError(t('editor.tryFailed'), def.message)
  if (await openLab(def.lab)) useLabEditorStore.getState().setOpen(false)
}

/** Lab JSON choisi par l'utilisateur, validé (null si annulé ou invalide, erreur affichée). */
async function pickLabFile(): Promise<LabDefinition | null> {
  const res = await window.serverlab.importLab()
  if (!res.ok) {
    if (!res.canceled) showError(t('editor.importFailed'), res.error ?? t('error.unknown'))
    return null
  }
  const parsed = parseLabText(res.value)
  if (!parsed.ok) {
    showError(t('editor.importFailed'), parsed.message)
    return null
  }
  return parsed.lab
}

/** Importe un lab et l'ouvre (sélecteur de labs). */
export async function importAndOpenLab(): Promise<void> {
  const lab = await pickLabFile()
  if (lab) await openLab(lab)
}

/** Importe un lab dans l'éditeur pour le modifier (départ reconstruit). */
export async function importIntoEditor(): Promise<void> {
  const lab = await pickLabFile()
  if (!lab) return
  let start
  try {
    start = buildLabStart(lab.start)
  } catch (e) {
    return showError(t('editor.importFailed'), e instanceof Error ? e.message : String(e))
  }
  const draft = draftFromLab(lab)
  const editorDraft: EditorDraft = {
    ...draft,
    criteria: draft.criteria.map((c) => ({
      key: nextKey++,
      label: c.label,
      hints: c.hints,
      type: c.check.type,
      values: checkValues(c.check),
      tested: null,
      check: c.check
    }))
  }
  useLabEditorStore.getState().reset(editorDraft, start)
}
