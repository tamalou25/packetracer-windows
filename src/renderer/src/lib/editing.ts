/**
 * Commandes du menu Édition, partagées entre le menu natif et le clavier.
 */
import { command } from '@engine/index'
import { useLabStore } from '../store/lab'
import { useUiStore } from '../store/ui'
import { runCommand } from './run'

/** Vrai si le focus est dans un champ de saisie (le clavier doit alors garder son comportement natif). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * Cible d'annuler / rétablir : `auto` (clavier) garde l'annulation native du texte dans un champ
 * de saisie ; `lab` (menu Édition, ligne de console vide) annule toujours la dernière commande.
 */
export type HistoryTarget = 'auto' | 'lab'

/** Annule la dernière commande du lab et affiche son libellé. */
export function undo(target: HistoryTarget = 'auto'): void {
  if (target === 'auto' && isEditableTarget(document.activeElement)) {
    document.execCommand('undo')
    return
  }
  const outcome = useLabStore.getState().undo()
  useUiStore.getState().notify('info', outcome.ok ? `Annulé : ${outcome.label}` : outcome.message)
}

/** Rétablit la dernière commande annulée et affiche son libellé. */
export function redo(target: HistoryTarget = 'auto'): void {
  if (target === 'auto' && isEditableTarget(document.activeElement)) {
    document.execCommand('redo')
    return
  }
  const outcome = useLabStore.getState().redo()
  useUiStore.getState().notify('info', outcome.ok ? `Rétabli : ${outcome.label}` : outcome.message)
}

export function deleteSelection(): void {
  const ui = useUiStore.getState()
  const { devices, link } = ui.selection
  if (devices.length > 0) {
    runCommand(command('topology.removeDevices', devices))
    for (const id of devices) ui.closeWindow(id)
  } else if (link) {
    runCommand(command('topology.disconnect', link))
  }
  ui.clearSelection()
}

export function copySelection(): void {
  const ui = useUiStore.getState()
  const { lab } = useLabStore.getState()
  const ids = new Set(ui.selection.devices)
  if (ids.size === 0) return
  const devices = [...ids].map((id) => lab.devices[id]).filter((d) => d !== undefined)
  const links = Object.values(lab.links).filter((l) => ids.has(l.a.deviceId) && ids.has(l.b.deviceId))
  ui.setClipboard({ devices, links })
  ui.notify('info', `${devices.length} équipement(s) copié(s).`)
}

export function paste(): void {
  const ui = useUiStore.getState()
  const clip = ui.clipboard
  if (!clip) return
  const offset = ui.nextPasteOffset()
  const created = runCommand(command('topology.duplicateDevices', clip, { x: offset, y: offset }))
  if (created) ui.select({ devices: created, link: null })
}

export function selectAll(): void {
  if (isEditableTarget(document.activeElement)) {
    document.execCommand('selectAll')
    return
  }
  const ids = Object.keys(useLabStore.getState().lab.devices)
  useUiStore.getState().select({ devices: ids, link: null })
}
