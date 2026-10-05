/**
 * Relie la barre de menu native au renderer :
 * - reçoit les commandes du menu,
 * - renvoie l'état de l'UI au main pour cocher les bonnes cases.
 */
import { useEffect } from 'react'
import { historyLabels, menuLabel } from '@engine/index'
import type { MenuCommandMessage } from '@shared/ipc'
import { useLabStore } from '../store/lab'
import { useUiStore } from '../store/ui'

export type MenuHandler = (msg: MenuCommandMessage) => void

export function useMenuBridge(handler: MenuHandler): void {
  const mode = useUiStore((s) => s.mode)
  const showPortLabels = useUiStore((s) => s.showPortLabels)
  const showProperties = useUiStore((s) => s.showProperties)
  const showMinimap = useUiStore((s) => s.showMinimap)
  const history = useLabStore((s) => s.history)
  const labels = historyLabels(history)
  const undoLabel = labels.undo === null ? null : menuLabel('Annuler', labels.undo)
  const redoLabel = labels.redo === null ? null : menuLabel('Rétablir', labels.redo)

  // Synchronise les cases à cocher, boutons radio et libellés Annuler / Rétablir du menu natif
  useEffect(() => {
    window.serverlab?.setMenuState({
      mode,
      showPortLabels,
      showProperties,
      showMinimap,
      undoLabel,
      redoLabel
    })
  }, [mode, showPortLabels, showProperties, showMinimap, undoLabel, redoLabel])

  useEffect(() => {
    if (!window.serverlab) return
    return window.serverlab.onMenuCommand(handler)
  }, [handler])
}
