/**
 * Bascule Temps réel / Simulation (coin inférieur droit).
 */
import { Clock, Footprints } from 'lucide-react'
import { useUiStore } from '../store/ui'

export function ModeSwitch() {
  const mode = useUiStore((s) => s.mode)
  const setMode = useUiStore((s) => s.setMode)
  const base = 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition'
  return (
    <div className="flex overflow-hidden rounded-md border border-slate-300 bg-white" role="radiogroup">
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'realtime'}
        data-testid="mode-realtime"
        title="Mode Temps réel (Ctrl+1)"
        onClick={() => setMode('realtime')}
        className={`${base} ${mode === 'realtime' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
      >
        <Clock size={14} /> Temps réel
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'simulation'}
        data-testid="mode-simulation"
        title="Mode Simulation (Ctrl+2)"
        onClick={() => setMode('simulation')}
        className={`${base} ${mode === 'simulation' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
      >
        <Footprints size={14} /> Simulation
      </button>
    </div>
  )
}
