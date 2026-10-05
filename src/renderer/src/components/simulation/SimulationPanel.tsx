/**
 * Panneau Simulation : contrôles pas à pas, filtres de protocoles, liste des événements, détail du PDU.
 */
import { Pause, Play, RotateCcw, StepForward } from 'lucide-react'
import { PROTOCOLS } from '@engine/index'
import { useLabStore } from '../../store/lab'
import { useSimStore, visibleSteps } from '../../store/sim'
import { useUiStore } from '../../store/ui'
import { OUTCOME_LABELS, PROTOCOL_COLORS } from '../../lib/protocols'
import { Button } from '../common/ui'

export function SimulationPanel() {
  const mode = useUiStore((s) => s.mode)
  const devices = useLabStore((s) => s.lab.devices)
  const { queue, played, playing, filters, selectedKey, stepCursor } = useSimStore()
  const sim = useSimStore.getState
  const op = queue[0]
  const totalSteps = op ? visibleSteps(op.trace, filters).length : 0
  const selected = played.find((e) => e.key === selectedKey) ?? null
  const name = (id: string) => devices[id]?.name ?? '?'

  if (mode !== 'simulation') {
    return (
      <div className="p-6 text-center text-sm text-slate-500">
        Passez en <b>mode Simulation</b> (Ctrl+2) pour suivre les paquets pas à pas.
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="simulation-panel">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="mb-2 text-xs text-slate-500">
          {op ? (
            <>
              <span className="font-semibold text-slate-700">{op.trace.title}</span> — pas{' '}
              {Math.min(stepCursor, totalSteps)} / {totalSteps}
              {queue.length > 1 && <span> (+{queue.length - 1} en attente)</span>}
            </>
          ) : (
            'Aucune opération en attente. Envoyez un PDU simple ou lancez une commande réseau.'
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => sim().step()}
            disabled={!op}
            data-testid="sim-step"
            title="Avancer d’un pas (F6)"
          >
            <StepForward size={14} /> Avancer
          </Button>
          <Button
            onClick={() => sim().setPlaying(!playing)}
            disabled={!op && !playing}
            title="Lecture automatique (F7)"
          >
            {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? 'Pause' : 'Lecture'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => sim().reset()}
            title="Vide la liste (les opérations en attente sont terminées instantanément) — F8"
          >
            <RotateCcw size={14} /> Réinitialiser
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200 px-4 py-2">
        {PROTOCOLS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => sim().toggleFilter(p)}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              filters[p]
                ? 'border-slate-300 bg-white text-slate-700'
                : 'border-transparent bg-slate-100 text-slate-400 line-through'
            }`}
            title={filters[p] ? `Masquer ${p}` : `Afficher ${p}`}
          >
            <span className={`h-2 w-2 rounded-sm ${PROTOCOL_COLORS[p].chip}`} /> {p}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-[11px]" data-testid="sim-events">
          <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-2 py-1 font-medium">#</th>
              <th className="px-1 py-1 font-medium">De</th>
              <th className="px-1 py-1 font-medium">Vers</th>
              <th className="px-1 py-1 font-medium">Type</th>
              <th className="px-1 py-1 font-medium">Résultat</th>
            </tr>
          </thead>
          <tbody>
            {played.map((e) => (
              <tr
                key={e.key}
                onClick={() => sim().select(e.key)}
                className={`cursor-pointer border-t border-slate-100 ${e.key === selectedKey ? 'bg-sky-50' : 'hover:bg-slate-50'}`}
              >
                <td className="px-2 py-1 text-slate-400">{e.index}</td>
                <td className="px-1 py-1">{name(e.fromDeviceId)}</td>
                <td className="px-1 py-1 font-medium">{name(e.toDeviceId)}</td>
                <td className="px-1 py-1">
                  <span className="flex items-center gap-1">
                    <span className={`h-2 w-2 rounded-sm ${PROTOCOL_COLORS[e.protocol].chip}`} />
                    {e.protocol}
                  </span>
                </td>
                <td className="px-1 py-1 text-slate-500">{OUTCOME_LABELS[e.outcome]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div
          className="max-h-[45%] overflow-y-auto border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs"
          data-testid="pdu-details"
        >
          <div className="mb-1 font-semibold text-slate-800">{selected.summary}</div>
          <p className="mb-2 text-slate-600">{selected.note}</p>
          {selected.layers.map((layer) => (
            <div key={layer.name} className="mb-2 rounded border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-2 py-1 font-semibold text-slate-600">
                Couche {layer.layer} — {layer.name}
              </div>
              <dl className="selectable grid grid-cols-[auto_1fr] gap-x-3 px-2 py-1 font-mono text-[11px]">
                {layer.fields.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="text-slate-800">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
