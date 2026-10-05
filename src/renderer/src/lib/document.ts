/**
 * Opérations sur le document : nouveau, ouvrir, enregistrer, récupération après incident.
 * Le contenu est validé par le moteur (parseSlab) ; le main ne fait que lire/écrire.
 */
import { createLab, parseSlab, serializeSlab } from '@engine/index'
import { UNTITLED, useLabStore } from '../store/lab'
import { useConsoleStore } from '../store/console'
import { useDesktopStore } from '../store/desktop'
import { useSimStore } from '../store/sim'
import { useUiStore } from '../store/ui'
import { getFlowInstance } from './flow'

function api() {
  return window.serverlab
}

/** Sérialise le document courant au format .slab. */
export function serializeCurrent(): string {
  const { lab, fileName } = useLabStore.getState()
  const viewport = getFlowInstance()?.getViewport() ?? null
  return serializeSlab(lab, {
    savedAt: new Date().toISOString(),
    appVersion: useUiStore.getState().appVersion,
    viewport,
    meta: { title: fileName.replace(/\.slab$/i, '') }
  })
}

/** Réinitialise l'interface liée au document (sélection, fenêtres, câblage). */
function resetUi(): void {
  const ui = useUiStore.getState()
  ui.clearSelection()
  ui.setCableStart(null)
  ui.setPduSource(null)
  ui.clearPduResults()
  for (const w of ui.windows) ui.closeWindow(w.deviceId)
  useSimStore.getState().discard()
  useConsoleStore.getState().reset()
  useDesktopStore.getState().reset()
  ui.setLastAutosave(null)
}

/** Charge un contenu .slab ; affiche une erreur explicite s'il est invalide. */
export function loadContent(
  content: string,
  file: { path: string | null; name: string },
  dirty = false
): boolean {
  const parsed = parseSlab(content)
  if (!parsed.ok) {
    useUiStore.getState().showModal({ title: 'Ouverture impossible', message: parsed.message })
    return false
  }
  resetUi()
  useLabStore.getState().load(parsed.doc.lab, file, parsed.doc.ui.viewport, dirty)
  return true
}

/**
 * Si le document a des modifications non enregistrées, demande quoi faire.
 * Renvoie vrai si l'on peut continuer (enregistré ou abandonné).
 */
export async function confirmDiscard(): Promise<boolean> {
  const { dirty, fileName } = useLabStore.getState()
  if (!dirty) return true
  const choice = await api().askSaveChanges(fileName)
  if (choice === 'cancel') return false
  if (choice === 'save') return saveDocument()
  return true
}

export async function newDocument(): Promise<void> {
  if (!(await confirmDiscard())) return
  resetUi()
  useLabStore.getState().load(createLab(), { path: null, name: UNTITLED })
  await api().clearAutosave()
}

export async function openDocument(): Promise<void> {
  if (!(await confirmDiscard())) return
  const res = await api().openFile()
  if (!res.ok) {
    if (!res.canceled)
      useUiStore.getState().showModal({ title: 'Ouverture impossible', message: res.error ?? '' })
    return
  }
  if (loadContent(res.value.content, { path: res.value.path, name: res.value.name })) {
    await api().clearAutosave()
  }
}

export async function openRecentDocument(path: string): Promise<void> {
  if (!(await confirmDiscard())) return
  const res = await api().openRecent(path)
  if (!res.ok) {
    useUiStore.getState().showModal({ title: 'Ouverture impossible', message: res.error ?? '' })
    return
  }
  if (loadContent(res.value.content, { path: res.value.path, name: res.value.name })) {
    await api().clearAutosave()
  }
}

/** Ouvre un fichier transmis par le système (double-clic sur un .slab). */
export async function openExternalDocument(file: {
  path: string
  name: string
  content: string
}): Promise<void> {
  if (!(await confirmDiscard())) return
  loadContent(file.content, { path: file.path, name: file.name })
}

/** Enregistre le document. Renvoie vrai en cas de succès. */
export async function saveDocument(saveAs = false): Promise<boolean> {
  const { filePath, fileName } = useLabStore.getState()
  const content = serializeCurrent()
  const res =
    filePath && !saveAs
      ? await api().saveFile(filePath, content)
      : await api().saveFileAs(content, fileName.replace(/\.slab$/i, ''))
  if (!res.ok) {
    if (!res.canceled)
      useUiStore.getState().showModal({ title: 'Enregistrement impossible', message: res.error ?? '' })
    return false
  }
  const path = res.value
  const name = path.split(/[\\/]/).pop() ?? path
  useLabStore.getState().markSaved(path, name)
  await api().clearAutosave()
  useUiStore.getState().notify('success', `Lab enregistré : ${name}`)
  return true
}

/** Au démarrage : ouvre le fichier passé au lancement ou propose la récupération. */
export async function startupDocument(): Promise<void> {
  const pending = await api().getPendingFile()
  if (pending) {
    loadContent(pending.content, { path: pending.path, name: pending.name })
    return
  }
  const recovered = await api().recoverAutosave()
  if (!recovered) return
  const parsed = parseSlab(recovered)
  if (!parsed.ok) {
    await api().clearAutosave()
    return
  }
  useUiStore.getState().showModal({
    title: 'Récupération',
    message:
      'ServerLab ne s’est pas fermé correctement lors de la dernière session. Voulez-vous restaurer le lab récupéré automatiquement ?',
    confirmLabel: 'Restaurer',
    cancelLabel: 'Ignorer',
    onConfirm: () => {
      const title = parsed.doc.meta.title || UNTITLED
      loadContent(recovered, { path: null, name: `${title} (récupéré)` }, true)
    },
    onCancel: () => {
      void api().clearAutosave()
    }
  })
}
