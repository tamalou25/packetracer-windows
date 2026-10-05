/**
 * Raccourcis clavier gérés par le renderer (ceux qui ne doivent pas être volés aux champs de saisie).
 */
import { useEffect } from 'react'
import {
  copySelection,
  deleteSelection,
  isEditableTarget,
  paste,
  redo,
  selectAll,
  undo
} from '../lib/editing'
import { useUiStore } from '../store/ui'

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      const ctrl = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (ctrl && key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault()
        redo()
      } else if (ctrl && key === 'c') {
        copySelection()
      } else if (ctrl && key === 'v') {
        e.preventDefault()
        paste()
      } else if (ctrl && key === 'a') {
        e.preventDefault()
        selectAll()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelection()
      } else if (e.key === 'Escape') {
        const ui = useUiStore.getState()
        ui.setTool('select')
        ui.setArmed(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
