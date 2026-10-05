/**
 * Mise en page principale : canvas au centre, propriétés à droite, palette en bas.
 */
import { useCallback, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import type { DeviceKind } from '@engine/index'
import type { MenuCommandMessage } from '@shared/ipc'
import { ModeSwitch } from './components/ModeSwitch'
import { Palette } from './components/Palette'
import { PropertiesPanel } from './components/PropertiesPanel'
import { TopologyCanvas } from './components/TopologyCanvas'
import { useMenuBridge } from './hooks/useMenuBridge'
import { useUiStore } from './store/ui'

export function App() {
  const showProperties = useUiStore((s) => s.showProperties)
  const [armed, setArmed] = useState<DeviceKind | null>(null)

  const onMenu = useCallback((msg: MenuCommandMessage) => {
    const ui = useUiStore.getState()
    switch (msg.command) {
      case 'sim:realtime':
        ui.setMode('realtime')
        break
      case 'sim:simulation':
        ui.setMode('simulation')
        break
      case 'view:togglePortLabels':
        ui.togglePortLabels()
        break
      case 'view:toggleProperties':
        ui.toggleProperties()
        break
      default:
        break
    }
  }, [])
  useMenuBridge(onMenu)

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
          <Palette armed={armed} onArm={setArmed} />
          <ModeSwitch />
        </footer>
      </div>
    </ReactFlowProvider>
  )
}
