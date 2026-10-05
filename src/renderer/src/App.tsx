/**
 * Mise en page principale : canvas au centre, propriétés à droite, palette en bas.
 */
import { useCallback } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import type { MenuCommandMessage } from '@shared/ipc'
import { TopologyCanvas } from './components/canvas/TopologyCanvas'
import { HelpPanel } from './components/common/HelpPanel'
import { Modal } from './components/common/Modal'
import { Toasts } from './components/common/Toasts'
import { DeviceWindows } from './components/device-window/DeviceWindow'
import { ModeSwitch } from './components/ModeSwitch'
import { Palette } from './components/Palette'
import { PropertiesPanel } from './components/properties/PropertiesPanel'
import { useDocumentLifecycle } from './hooks/useDocumentLifecycle'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useMenuBridge } from './hooks/useMenuBridge'
import { newDocument, openDocument, openRecentDocument, saveDocument } from './lib/document'
import { copySelection, deleteSelection, paste, redo, selectAll, undo } from './lib/editing'
import { getFlowInstance } from './lib/flow'
import { useUiStore } from './store/ui'

/** Exécute une commande du menu natif. */
function handleMenuCommand(msg: MenuCommandMessage): void {
  const ui = useUiStore.getState()
  const flow = getFlowInstance()
  switch (msg.command) {
    case 'file:new':
      void newDocument()
      break
    case 'file:open':
      void openDocument()
      break
    case 'file:openRecent':
      if (msg.arg) void openRecentDocument(msg.arg)
      break
    case 'file:save':
      void saveDocument()
      break
    case 'file:saveAs':
      void saveDocument(true)
      break
    case 'file:openLab':
      ui.notify('info', 'Le mode Labs arrive à la phase 10.')
      break
    case 'edit:undo':
      undo()
      break
    case 'edit:redo':
      redo()
      break
    case 'edit:copy':
      copySelection()
      break
    case 'edit:paste':
      paste()
      break
    case 'edit:delete':
      deleteSelection()
      break
    case 'edit:selectAll':
      selectAll()
      break
    case 'view:zoomIn':
      void flow?.zoomIn()
      break
    case 'view:zoomOut':
      void flow?.zoomOut()
      break
    case 'view:fit':
      void flow?.fitView({ padding: 0.3, maxZoom: 1.2 })
      break
    case 'view:togglePortLabels':
      ui.togglePortLabels()
      break
    case 'view:toggleProperties':
      ui.toggleProperties()
      break
    case 'sim:realtime':
      ui.setMode('realtime')
      break
    case 'sim:simulation':
      ui.setMode('simulation')
      break
    case 'help:guide':
      ui.setHelpPanel('guide')
      break
    case 'help:shortcuts':
      ui.setHelpPanel('shortcuts')
      break
    default:
      break
  }
}

export function App() {
  const showProperties = useUiStore((s) => s.showProperties)
  const onMenu = useCallback((msg: MenuCommandMessage) => handleMenuCommand(msg), [])
  useMenuBridge(onMenu)
  useKeyboardShortcuts()
  useDocumentLifecycle()

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col">
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1">
            <TopologyCanvas />
          </main>
          {showProperties && <PropertiesPanel />}
        </div>
        <footer className="flex items-center justify-between gap-4 border-t border-slate-200 bg-slate-50 px-4 py-2">
          <Palette />
          <ModeSwitch />
        </footer>
      </div>
      <DeviceWindows />
      <Toasts />
      <HelpPanel />
      <Modal />
    </ReactFlowProvider>
  )
}
