/**
 * Observateur d'événements simplifié (journal Système, Sécurité…).
 */
import { useState } from 'react'
import { CircleAlert, Info, TriangleAlert } from 'lucide-react'
import type { HostDevice } from '@engine/index'
import { formatSimTime } from '../../../lib/format'
import { Section } from '../../common/ui'

const LEVELS = {
  information: { label: 'Information', icon: Info, cls: 'text-sky-600' },
  warning: { label: 'Avertissement', icon: TriangleAlert, cls: 'text-amber-600' },
  error: { label: 'Erreur', icon: CircleAlert, cls: 'text-red-600' }
} as const

export function EventLogView({ device }: { device: HostDevice }) {
  const entries = [...device.host.eventLog].reverse()
  const [selected, setSelected] = useState<number | null>(entries[0]?.id ?? null)
  const current = entries.find((e) => e.id === selected)
  return (
    <Section title={`Observateur d’événements — ${entries.length} événement(s)`}>
      <div className="max-h-64 overflow-y-auto rounded border border-slate-200">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-2 py-1 font-medium">Niveau</th>
              <th className="px-2 py-1 font-medium">Date et heure</th>
              <th className="px-2 py-1 font-medium">Journal</th>
              <th className="px-2 py-1 font-medium">Source</th>
              <th className="px-2 py-1 font-medium">ID</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2 py-3 text-slate-400">
                  Aucun événement.
                </td>
              </tr>
            )}
            {entries.map((e) => {
              const level = LEVELS[e.level]
              const Icon = level.icon
              return (
                <tr
                  key={e.id}
                  onClick={() => setSelected(e.id)}
                  className={`cursor-pointer border-t border-slate-100 ${e.id === selected ? 'bg-sky-50' : 'hover:bg-slate-50'}`}
                >
                  <td className="px-2 py-1">
                    <span className={`flex items-center gap-1 ${level.cls}`}>
                      <Icon size={12} /> {level.label}
                    </span>
                  </td>
                  <td className="px-2 py-1 font-mono">{formatSimTime(e.time)}</td>
                  <td className="px-2 py-1">{e.log}</td>
                  <td className="px-2 py-1">{e.source}</td>
                  <td className="px-2 py-1">{e.eventId}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {current && (
        <p className="selectable mt-2 rounded bg-slate-50 p-2 text-xs text-slate-700">{current.message}</p>
      )}
    </Section>
  )
}
