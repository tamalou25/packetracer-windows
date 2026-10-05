/**
 * Panneau des propriétés (à droite) : détails de la sélection.
 */
import { MousePointerClick } from 'lucide-react'

export function PropertiesPanel() {
  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-l border-slate-200 bg-white"
      aria-label="Propriétés"
      data-testid="properties-panel"
    >
      <header className="border-b border-slate-200 px-4 py-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Propriétés
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-slate-400">
        <MousePointerClick size={28} strokeWidth={1.5} />
        <p>Sélectionnez un équipement ou un câble pour afficher ses propriétés.</p>
      </div>
    </aside>
  )
}
