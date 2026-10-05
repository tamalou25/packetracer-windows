/**
 * Commandes du menu Édition, partagées entre le menu natif et le clavier.
 */
import { disconnect, duplicateDevices, removeDevices } from '@engine/index'
import { useLabStore } from '../store/lab'
import { useUiStore } from '../store/ui'
import { runAction } from './run'

/** Vrai si le focus est dans un champ de saisie (le clavier doit alors garder son comportement natif). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function undo(): void {
  if (isEditableTarget(document.activeElement)) {
    document.execCommand('undo')
    return
  }
  if (!useLabStore.getState().undo()) useUiStore.getState().notify('info', 'Rien à annuler.')
}

export function redo(): void {
  if (isEditableTarget(document.activeElement)) {
    document.execCommand('redo')
    return
  }
  if (!useLabStore.getState().redo()) useUiStore.getState().notify('info', 'Rien à rétablir.')
}

export function deleteSelection(): void {
  const ui = useUiStore.getState()
  const { devices, link } = ui.selection
  if (devices.length > 0) {
    runAction((lab) => removeDevices(lab, devices))
    for (const id of devices) ui.closeWindow(id)
  } else if (link) {
    runAction((lab) => disconnect(lab, link))
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
  const created = runAction((lab) => duplicateDevices(lab, clip, { x: offset, y: offset }))
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
