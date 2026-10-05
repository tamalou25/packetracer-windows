/**
 * Onglet Bureau : icônes d'applications, fenêtre de l'application active et barre des tâches.
 */
import type { ReactNode } from 'react'
import { LogOut, X } from 'lucide-react'
import { formatShortDate, logoff, type HostDevice } from '@engine/index'
import { LogonScreen } from './LogonScreen'
import { useDesktopStore } from '../../store/desktop'
import { useLabStore } from '../../store/lab'
import { Terminal } from '../console/Terminal'
import { EventLogView } from '../device-window/config/EventLogView'
import { appInfo, DESKTOP_APPS } from './apps'
import { AducApp } from '../apps/AducApp'
import { DhcpApp } from '../apps/DhcpApp'
import { DnsApp } from '../apps/DnsApp'
import { NetworkSettingsApp } from './NetworkSettingsApp'
import { ServerManagerApp } from './ServerManagerApp'
import { SystemApp } from './SystemApp'

function renderApp(id: string, device: HostDevice): ReactNode {
  switch (id) {
    case 'servermanager':
      return device.kind === 'server' ? <ServerManagerApp device={device} /> : null
    case 'cmd':
      return <Terminal deviceId={device.id} kind="cmd" autoFocus />
    case 'powershell':
      return <Terminal deviceId={device.id} kind="powershell" autoFocus />
    case 'network':
      return <NetworkSettingsApp device={device} />
    case 'dhcp':
      return device.kind === 'server' ? <DhcpApp device={device} /> : null
    case 'dns':
      return device.kind === 'server' ? <DnsApp device={device} /> : null
    case 'aduc':
      return <AducApp device={device} />
    case 'system':
      return <SystemApp device={device} />
    case 'events':
      return (
        <div className="h-full overflow-y-auto bg-white">
          <EventLogView device={device} />
        </div>
      )
    default:
      return <div className="p-6 text-sm text-slate-500">Application indisponible.</div>
  }
}

/** Référence stable : un sélecteur ne doit pas renvoyer un nouveau tableau à chaque lecture. */
const NO_APPS: string[] = []

export function DesktopTab({ device }: { device: HostDevice }) {
  const open = useDesktopStore((s) => s.open[device.id] ?? NO_APPS)
  const active = useDesktopStore((s) => s.active[device.id] ?? null)
  const clock = useLabStore((s) => s.lab.clock)
  const { launch, close, focus } = useDesktopStore.getState()
  const apps = DESKTOP_APPS.filter((a) => a.available(device))
  const current = active ? appInfo(active) : undefined
  const session = device.host.session
  // Le système simulé garde son apparence claire, quel que soit le thème de l'application
  if (!session)
    return (
      <div data-theme="light" className="h-full">
        <LogonScreen device={device} />
      </div>
    )

  return (
    <div data-theme="light" className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1 bg-gradient-to-br from-sky-800 via-indigo-800 to-slate-900">
        <div className="grid h-full w-fit grid-flow-col grid-rows-[repeat(auto-fill,88px)] content-start gap-1 overflow-hidden p-3">
          {apps.map((a) => (
            <button
              key={a.id}
              type="button"
              onDoubleClick={() => launch(device.id, a.id)}
              onKeyDown={(e) => e.key === 'Enter' && launch(device.id, a.id)}
              data-testid={`desktop-app-${a.id}`}
              className="flex w-24 flex-col items-center gap-1 rounded p-2 text-white hover:bg-white/15 focus:bg-white/20 focus:outline-none"
              title={`${a.label} (double-clic)`}
            >
              <span className={`flex h-11 w-11 items-center justify-center rounded-lg shadow ${a.color}`}>
                <a.icon size={24} />
              </span>
              <span className="text-center text-[11px] leading-tight drop-shadow">{a.label}</span>
            </button>
          ))}
        </div>
        {current && (
          <div
            className="absolute inset-3 flex flex-col overflow-hidden rounded-md border border-slate-400 bg-white shadow-2xl"
            data-testid={`app-${current.id}`}
          >
            <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700">
              <current.icon size={14} /> {current.label}
              <button
                type="button"
                className="ml-auto rounded p-0.5 hover:bg-red-600 hover:text-white"
                onClick={() => close(device.id, current.id)}
                title="Fermer"
                data-testid="close-app"
              >
                <X size={14} />
              </button>
            </div>
            <div className="min-h-0 flex-1">{renderApp(current.id, device)}</div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 border-t border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200">
        <button
          type="button"
          onClick={() => focus(device.id, null)}
          className="rounded px-2 py-1 hover:bg-white/10"
          title="Afficher le Bureau"
        >
          Bureau
        </button>
        {open.map((id) => {
          const a = appInfo(id)
          if (!a) return null
          return (
            <button
              key={id}
              type="button"
              onClick={() => focus(device.id, id)}
              className={`flex items-center gap-1 rounded px-2 py-1 ${active === id ? 'bg-white/20' : 'hover:bg-white/10'}`}
            >
              <a.icon size={13} /> {a.label}
            </button>
          )
        })}
        <span className="ml-auto flex items-center gap-3 pr-1 text-slate-400">
          <span>
            {session.domain ?? device.name}\{session.user}
          </span>
          <button
            type="button"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10"
            title="Se déconnecter"
            data-testid="logoff"
            onClick={() => {
              useDesktopStore.getState().reset()
              useLabStore
                .getState()
                .run((lab) => ({ ok: true, state: logoff(lab, device.id), value: undefined }))
            }}
          >
            <LogOut size={12} /> Se déconnecter
          </button>
          <span className="font-mono">{formatShortDate(clock)}</span>
        </span>
      </div>
    </div>
  )
}
