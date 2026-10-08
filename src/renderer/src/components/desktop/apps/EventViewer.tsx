/**
 * Observateur d'événements : journaux système (Application, Sécurité, Système) et journaux des
 * applications et des services (Service d'annuaire, Serveur DNS), filtre du journal actuel (ID,
 * niveau, source, période), affichages personnalisés (vues prédéfinies du journal Sécurité),
 * détail de l'événement, effacement.
 */
import { useState } from 'react'
import { BookOpen, CircleAlert, Filter, FolderClosed, Info, ScrollText, TriangleAlert } from 'lucide-react'
import {
  DETECTION_VIEWS,
  type EventFilter,
  type EventLogEntry,
  type HostDevice,
  command,
  filterEvents
} from '@engine/index'
import { FormDialog } from '../../common/FormDialog'
import { formatSimTime } from '../../../lib/format'
import { runCommand } from '../../../lib/run'
import { useLabStore } from '../../../store/lab'
import { Mmc, MmcAction, type MmcNode } from '../../mmc/Mmc'
import { MessageBox } from '../shell/classic'

type LogName = EventLogEntry['log']

const SYSTEM_LOGS: LogName[] = ['Application', 'Sécurité', 'Système']
const SERVICE_LOGS: LogName[] = ['Service d’annuaire', 'Serveur DNS']

/** Périodes du filtre (« Connecté » : à tout moment, dernière heure…). */
const PERIODS = [
  { label: 'À tout moment', ms: 0 },
  { label: 'Dernière heure', ms: 3_600_000 },
  { label: '12 dernières heures', ms: 12 * 3_600_000 },
  { label: '24 dernières heures', ms: 24 * 3_600_000 },
  { label: '7 derniers jours', ms: 7 * 86_400_000 }
]

const LEVELS = {
  information: { label: 'Information', icon: Info, cls: 'text-[#0078d7]' },
  warning: { label: 'Avertissement', icon: TriangleAlert, cls: 'text-[#d39c00]' },
  error: { label: 'Erreur', icon: CircleAlert, cls: 'text-[#e81123]' }
} as const

export function EventViewer({ device }: { device: HostDevice }) {
  const lab = useLabStore((s) => s.lab)
  const [selected, setSelected] = useState('log:Système')
  const [eventId, setEventId] = useState<number | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [filter, setFilter] = useState<EventFilter | null>(null)
  const [filterDialog, setFilterDialog] = useState(false)
  // Affichage personnalisé : filtre prédéfini sur le journal Sécurité
  const view = selected.startsWith('view:')
    ? DETECTION_VIEWS.find((v) => `view:${v.id}` === selected)
    : undefined
  const log = view ? 'Sécurité' : selected.startsWith('log:') ? (selected.slice(4) as LogName) : null
  const all = log ? device.host.eventLog.filter((e) => e.log === log) : []
  const active = view?.filter ?? filter
  const entries = (active ? filterEvents(all, active) : all).reverse()
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
          id: 'views',
          label: 'Affichages personnalisés',
          icon: FolderClosed,
          iconClass: 'text-amber-500',
          children: DETECTION_VIEWS.map((v) => ({
            id: `view:${v.id}`,
            label: v.title,
            icon: Filter,
            iconClass: 'text-slate-500'
          }))
        },
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
          setFilter(null)
        }}
        testId="eventvwr"
        actions={
          log && !view ? (
            <>
              <MmcAction onClick={() => setFilterDialog(true)} testId="eventvwr-filter">
                Filtrer le journal actuel…
              </MmcAction>
              {filter && (
                <MmcAction onClick={() => setFilter(null)} testId="eventvwr-unfilter">
                  Effacer le filtre
                </MmcAction>
              )}
              <MmcAction onClick={() => setConfirmClear(true)} testId="eventvwr-clear">
                Effacer le journal…
              </MmcAction>
            </>
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
              <span className="font-semibold">{view?.title ?? log}</span>
              <span className="ml-2 text-[#555]" data-testid="eventvwr-count">
                {active
                  ? `Filtré : journal : ${log} ; nombre d’événements : ${entries.length} sur ${all.length}`
                  : `Nombre d’événements : ${entries.length}`}
              </span>
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
      {filterDialog && log && (
        <FormDialog
          title="Filtrer le journal actuel"
          fields={[
            {
              key: 'period',
              label: 'Connecté',
              type: 'select',
              options: PERIODS.map((p) => ({ value: String(p.ms), label: p.label }))
            },
            {
              key: 'level',
              label: 'Niveau de l’événement',
              type: 'select',
              options: [
                { value: '', label: 'Tous' },
                { value: 'error', label: 'Erreur' },
                { value: 'warning', label: 'Avertissement' },
                { value: 'information', label: 'Information' }
              ]
            },
            { key: 'source', label: 'Sources d’événements', placeholder: 'Security-Auditing' },
            { key: 'ids', label: 'ID d’événements (séparés par des virgules)', placeholder: '4624, 4625' }
          ]}
          onSubmit={(v) => {
            const ids = String(v['ids'] ?? '')
              .split(/[,;\s]+/)
              .map((x) => Number(x))
              .filter((n) => Number.isInteger(n) && n > 0)
            const ms = Number(v['period'])
            const level = String(v['level'] ?? '')
            const source = String(v['source'] ?? '').trim()
            setFilter({
              ...(ids.length > 0 ? { ids } : {}),
              ...(level ? { levels: [level as EventLogEntry['level']] } : {}),
              ...(source ? { sources: [source] } : {}),
              ...(ms > 0 ? { since: lab.clock - ms } : {})
            })
            setEventId(null)
            return true
          }}
          onClose={() => setFilterDialog(false)}
          testId="eventvwr-filter-dialog"
        />
      )}
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
                runCommand(command('system.clearEventLog', device.id, log))
              }
            },
            { label: 'Annuler', onClick: () => setConfirmClear(false) }
          ]}
        />
      )}
    </div>
  )
}
