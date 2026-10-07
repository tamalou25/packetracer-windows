/**
 * Panneau de droite à onglets : Propriétés / Simulation / Audit, et Lab quand un lab est ouvert.
 */
import { AuditPanel } from './audit/AuditPanel'
import { LabPanel } from './labs/LabPanel'
import { SimulationPanel } from './simulation/SimulationPanel'
import { PropertiesPanel } from './properties/PropertiesPanel'
import { useLabsStore } from '../store/labs'
import { useUiStore, type RightTab } from '../store/ui'

export function RightPanel() {
  const selected = useUiStore((s) => s.rightTab)
  const setTab = useUiStore((s) => s.setRightTab)
  const lab = useLabsStore((s) => s.active)
  const TABS: { id: RightTab; label: string }[] = [
    ...(lab ? [{ id: 'lab' as const, label: 'Lab' }] : []),
    { id: 'properties', label: 'Propriétés' },
    { id: 'simulation', label: 'Simulation' },
    { id: 'audit', label: 'Audit' }
  ]
  // Onglet Lab demandé sans lab ouvert : retour aux propriétés
  const tab = selected === 'lab' && !lab ? 'properties' : selected
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-panel" aria-label="Panneau latéral">
      <div className="flex border-b border-line" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            data-testid={`right-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`flex-1 border-b-2 px-3 py-2 text-[11px] font-semibold tracking-wider uppercase ${
              tab === t.id ? 'border-accent text-fg' : 'border-transparent text-fg-subtle hover:text-fg-muted'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'lab' ? (
        <LabPanel />
      ) : tab === 'properties' ? (
        <PropertiesPanel />
      ) : tab === 'audit' ? (
        <AuditPanel />
      ) : (
        <SimulationPanel />
      )}
    </aside>
  )
}
