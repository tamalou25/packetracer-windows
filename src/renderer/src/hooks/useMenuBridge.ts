/**
 * Relie la barre de menu native au renderer :
 * - reçoit les commandes du menu,
 * - renvoie l'état de l'UI au main pour cocher les bonnes cases.
 */
import { useEffect } from 'react'
import type { MenuCommandMessage } from '@shared/ipc'
import { useUiStore } from '../store/ui'

export type MenuHandler = (msg: MenuCommandMessage) => void

export function useMenuBridge(handler: MenuHandler): void {
  const mode = useUiStore((s) => s.mode)
  const showPortLabels = useUiStore((s) => s.showPortLabels)
  const showProperties = useUiStore((s) => s.showProperties)

  // Synchronise les cases à cocher / boutons radio du menu natif
  useEffect(() => {
    window.serverlab?.setMenuState({ mode, showPortLabels, showProperties })
  }, [mode, showPortLabels, showProperties])

  useEffect(() => {
    if (!window.serverlab) return
    return window.serverlab.onMenuCommand(handler)
  }, [handler])
}
