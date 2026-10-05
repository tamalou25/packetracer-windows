/**
 * Observateur d'événements : journaux système (Application, Sécurité, Système) et journaux des
 * applications et des services (Service d'annuaire, Serveur DNS), détail de l'événement, effacement.
 */
import { useState } from 'react'
import { BookOpen, CircleAlert, FolderClosed, Info, ScrollText, TriangleAlert } from 'lucide-react'
import { clearEventLog, type EventLogEntry, type HostDevice } from '@engine/index'
import { formatSimTime } from '../../../lib/format'
import { runAction } from '../../../lib/run'
import { Mmc, MmcAction, type MmcNode } from '../../mmc/Mmc'
import { MessageBox } from '../shell/classic'

type LogName = EventLogEntry['log']

const SYSTEM_LOGS: LogName[] = ['Application', 'Sécurité', 'Système']
const SERVICE_LOGS: LogName[] = ['Service d’annuaire', 'Serveur DNS']

const LEVELS = {
  information: { label: 'Information', icon: Info, cls: 'text-[#0078d7]' },
  warning: { label: 'Avertissement', icon: TriangleAlert, cls: 'text-[#d39c00]' },
  error: { label: 'Erreur', icon: CircleAlert, cls: 'text-[#e81123]' }
} as const

export function EventViewer({ device }: { device: HostDevice }) {
  const [selected, setSelected] = useState('log:Système')
  const [eventId, setEventId] = useState<number | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const log = selected.startsWith('log:') ? (selected.slice(4) as LogName) : null
  const entries = log ? device.host.eventLog.filter((e) => e.log === log).reverse() : []
  const current = entries.find((e) => e.id === eventId) ?? entries[0]
  const fqdn = device.host.domain ? `${device.name}.${device.host.domain}` : device.name

  const logNode = (name: LogName): MmcNode => ({
    id: `log:${name}`,
    label: name,
    icon: ScrollText,
    iconClass: 'text-slate-500'
  })
  const nodes: MmcNode[] = [
    {
      id: 'root',
      label: 'Observateur d’événements (local)',
      icon: BookOpen,
      iconClass: 'text-amber-600',
      children: [
        {
          id: 'system',
          label: 'Journaux système',
          icon: FolderClosed,
          iconClass: 'text-amber-500',
          children: SYSTEM_LOGS.map(logNode)
        },
        {
          id: 'services',
          label: 'Journaux des applications et des services',
          icon: FolderClosed,
          iconClass: 'text-amber-500',
          children: SERVICE_LOGS.map(logNode)
        }
      ]
    }
  ]

  return (
    <div className="relative h-full">
      <Mmc
        nodes={nodes}
        selected={selected}
        onSelect={(id) => {
          setSelected(id)
          setEventId(null)
        }}
        testId="eventvwr"
        actions={
          log ? (
            <MmcAction onClick={() => setConfirmClear(true)} testId="eventvwr-clear">
              Effacer le journal…
            </MmcAction>
          ) : undefined
        }
      >
        {!log ? (
          <div className="p-4 text-xs text-black">
            <h3 className="mb-2 text-sm font-semibold">Vue d’ensemble et résumé</h3>
            <table className="w-full max-w-md">
              <thead className="text-left text-[#555]">
                <tr>
                  <th className="py-1 font-medium">Journal</th>
                  <th className="py-1 font-medium">Événements</th>
                  <th className="py-1 font-medium">Erreurs</th>
                  <th className="py-1 font-medium">Avertissements</th>
                </tr>
              </thead>
              <tbody>
                {[...SYSTEM_LOGS, ...SERVICE_LOGS].map((name) => {
                  const list = device.host.eventLog.filter((e) => e.log === name)
                  return (
                    <tr key={name} className="border-t border-slate-100">
                      <td className="py-1">{name}</td>
                      <td>{list.length}</td>
                      <td>{list.filter((e) => e.level === 'error').length}</td>
                      <td>{list.filter((e) => e.level === 'warning').length}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex h-full flex-col text-xs text-black">
            <div className="border-b border-slate-200 bg-[#f7f7f7] px-2 py-1">
              <span className="font-semibold">{log}</span>
              <span className="ml-2 text-[#555]">Nombre d’événements : {entries.length}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <table className="w-full" data-testid="eventvwr-events">
                <thead className="sticky top-0 bg-white text-left text-[#555] shadow-[0_1px_0_#e5e5e5]">
                  <tr>
                    <th className="px-2 py-1 font-medium">Niveau</th>
                    <th className="px-2 py-1 font-medium">Date et heure</th>
                    <th className="px-2 py-1 font-medium">Source</th>
                    <th className="px-2 py-1 font-medium">ID de l’événement</th>
                    <th className="px-2 py-1 font-medium">Catégorie de la tâche</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 py-3 text-[#777]">
                        Aucun événement dans ce journal.
                      </td>
                    </tr>
                  )}
                  {entries.map((e) => {
                    const level = LEVELS[e.level]
                    return (
                      <tr
                        key={e.id}
                        onClick={() => setEventId(e.id)}
                        className={`cursor-default ${current?.id === e.id ? 'bg-[#cce8ff]' : 'hover:bg-[#e5f3ff]'}`}
                      >
                        <td className="px-2 py-0.5">
                          <span className="flex items-center gap-1">
                            <level.icon size={13} className={level.cls} /> {level.label}
                          </span>
                        </td>
                        <td className="px-2 py-0.5">{formatSimTime(e.time)}</td>
                        <td className="px-2 py-0.5">{e.source}</td>
                        <td className="px-2 py-0.5">{e.eventId}</td>
                        <td className="px-2 py-0.5">Aucun</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {current && (
              <div
                className="h-44 shrink-0 overflow-y-auto border-t border-slate-300 bg-white p-2"
                data-testid="eventvwr-detail"
              >
                <div className="mb-1 font-semibold">
                  Événement {current.eventId}, {current.source}
                </div>
                <p className="selectable mb-2 min-h-10 border border-slate-200 p-1.5">{current.message}</p>
                <dl className="grid grid-cols-[130px_1fr_110px_1fr] gap-x-2 gap-y-0.5">
                  <dt className="text-[#555]">Nom du journal :</dt>
                  <dd>{current.log}</dd>
                  <dt className="text-[#555]">Source :</dt>
                  <dd>{current.source}</dd>
                  <dt className="text-[#555]">ID de l’événement :</dt>
                  <dd>{current.eventId}</dd>
                  <dt className="text-[#555]">Ouvert le :</dt>
                  <dd>{formatSimTime(current.time)}</dd>
                  <dt className="text-[#555]">Niveau :</dt>
                  <dd>{LEVELS[current.level].label}</dd>
                  <dt className="text-[#555]">Ordinateur :</dt>
                  <dd>{fqdn}</dd>
                </dl>
              </div>
            )}
          </div>
        )}
      </Mmc>
      {confirmClear && log && (
        <MessageBox
          title="Observateur d’événements"
          icon="question"
          message={`Voulez-vous effacer le journal « ${log} » ? Les événements seront définitivement supprimés.`}
          buttons={[
            {
              label: 'Effacer',
              primary: true,
              testId: 'eventvwr-confirm-clear',
              onClick: () => {
                setConfirmClear(false)
                runAction((lab) => clearEventLog(lab, device.id, log))
              }
            },
            { label: 'Annuler', onClick: () => setConfirmClear(false) }
          ]}
        />
      )}
    </div>
  )
}
