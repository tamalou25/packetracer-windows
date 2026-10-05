/**
 * Observateur d'événements simplifié (journal Système, Sécurité…).
 */
import { useState } from 'react'
import { CircleAlert, Info, TriangleAlert } from 'lucide-react'
import type { HostDevice } from '@engine/index'
import { formatSimTime } from '../../../lib/format'
import { Section } from '../../common/ui'

const LEVELS = {
  information: { label: 'Information', icon: Info, cls: 'text-info' },
  warning: { label: 'Avertissement', icon: TriangleAlert, cls: 'text-warn' },
  error: { label: 'Erreur', icon: CircleAlert, cls: 'text-danger' }
} as const

export function EventLogView({ device }: { device: HostDevice }) {
  const entries = [...device.host.eventLog].reverse()
  const [selected, setSelected] = useState<number | null>(entries[0]?.id ?? null)
  const current = entries.find((e) => e.id === selected)
  return (
    <Section title={`Observateur d’événements — ${entries.length} événement(s)`}>
      <div className="max-h-64 overflow-y-auto rounded border border-line">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface-2 text-left text-fg-muted">
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
                <td colSpan={5} className="px-2 py-3 text-fg-subtle">
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
                  className={`cursor-pointer border-t border-line ${e.id === selected ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}
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
        <p className="selectable mt-2 rounded bg-surface-2 p-2 text-xs text-fg">{current.message}</p>
      )}
    </Section>
  )
}
