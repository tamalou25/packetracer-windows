/**
 * Panneau de droite à onglets : Propriétés / Simulation.
 */
import { SimulationPanel } from './simulation/SimulationPanel'
import { PropertiesPanel } from './properties/PropertiesPanel'
import { useUiStore, type RightTab } from '../store/ui'

const TABS: { id: RightTab; label: string }[] = [
  { id: 'properties', label: 'Propriétés' },
  { id: 'simulation', label: 'Simulation' }
]

export function RightPanel() {
  const tab = useUiStore((s) => s.rightTab)
  const setTab = useUiStore((s) => s.setRightTab)
  return (
    <aside
      className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white"
      aria-label="Panneau latéral"
    >
      <div className="flex border-b border-slate-200" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            data-testid={`right-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`flex-1 border-b-2 px-3 py-2 text-xs font-semibold tracking-wide uppercase ${
              tab === t.id
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'properties' ? <PropertiesPanel /> : <SimulationPanel />}
    </aside>
  )
}
