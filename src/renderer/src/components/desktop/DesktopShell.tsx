/**
 * Bureau simulé d'un serveur ou d'un poste, à la manière d'un système de bureau réel :
 * écran de verrouillage, fond d'écran, fenêtres multiples, barre des tâches, menu Démarrer.
 * Le système simulé garde son apparence claire, quel que soit le thème de l'application.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { logoff, restartComputer, setPower, type HostDevice } from '@engine/index'
import { launch, setDesktopArea } from '../../lib/desktop'
import { runAction } from '../../lib/run'
import { activeWindow, useDesktopStore } from '../../store/desktop'
import { useLabStore } from '../../store/lab'
import { appInfo } from './apps'
import { renderApp } from './renderApp'
import { AppWindow } from './shell/AppWindow'
import { MessageBox } from './shell/classic'
import { LockScreen } from './shell/LockScreen'
import {
  NetworkFlyout,
  SearchPanel,
  StartMenu,
  submitSearch,
  WinXMenu,
  type PowerAction
} from './shell/Menus'
import { Taskbar, type ShellMenu } from './shell/Taskbar'
import { WinButton } from './shell/classic'

const REASONS = [
  'Autre (planifié)',
  'Autre (non planifié)',
  'Maintenance du matériel (planifiée)',
  'Système d’exploitation : reconfiguration (planifiée)',
  'Application : maintenance (planifiée)'
]

export function DesktopShell({ device }: { device: HostDevice }) {
  const desktop = useDesktopStore((s) => s.desktops[device.id])
  const store = useDesktopStore.getState()
  const areaRef = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState({ w: 960, h: 560 })
  const [menu, setMenu] = useState<ShellMenu>(null)
  const [query, setQuery] = useState('')
  const [shutdown, setShutdown] = useState<'restart' | 'shutdown' | null>(null)
  const [reason, setReason] = useState(REASONS[0] ?? '')
  const session = device.host.session
  const locked = desktop?.locked ?? false

  // Un redémarrage ferme toutes les fenêtres et revient à l'écran de verrouillage
  useEffect(() => {
    store.syncBoot(device.id, device.host.bootedAt)
  }, [device.id, device.host.bootedAt, store])

  // Ouverture de session : le Gestionnaire de serveur démarre automatiquement sur un serveur
  useEffect(() => {
    if (!session || locked || !desktop || desktop.autoStarted) return
    store.markAutoStarted(device.id)
    if (device.kind === 'server') launch(device.id, 'servermanager')
  }, [session, locked, desktop, device.id, device.kind, store])

  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    const measure = () => {
      const size = { w: el.clientWidth, h: el.clientHeight }
      setArea(size)
      setDesktopArea(device.id, size)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [device.id, session, locked])

  if (!session || locked)
    return (
      <div data-theme="light" className="h-full">
        <LockScreen device={device} mode={session ? 'unlock' : 'logon'} />
      </div>
    )

  const windows = desktop?.windows ?? []
  const active = activeWindow(desktop)
  const closeMenu = () => setMenu(null)

  const power = (action: PowerAction) => {
    closeMenu()
    if (action === 'lock') store.setLocked(device.id, true)
    else if (action === 'logoff') {
      store.closeAll(device.id)
      useLabStore.getState().run((lab) => ({ ok: true, state: logoff(lab, device.id), value: undefined }))
    } else if (device.kind === 'server') {
      // Suivi des événements d'arrêt : un serveur demande la raison
      setShutdown(action)
    } else if (action === 'restart') runAction((lab) => restartComputer(lab, device.id))
    else runAction((lab) => setPower(lab, device.id, false))
  }

  const confirmShutdown = () => {
    const action = shutdown
    setShutdown(null)
    if (action === 'restart') runAction((lab) => restartComputer(lab, device.id, reason))
    else if (action === 'shutdown') runAction((lab) => setPower(lab, device.id, false))
  }

  return (
    <div data-theme="light" className="flex h-full flex-col" data-testid="desktop">
      <div
        ref={areaRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-[radial-gradient(ellipse_at_70%_25%,#2f78c4_0%,#174a86_38%,#0c2a52_72%,#071a35_100%)]"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) closeMenu()
        }}
      >
        <div className="absolute top-2 left-2 flex flex-col gap-2">
          <button
            type="button"
            onDoubleClick={() => launch(device.id, 'recycle')}
            onKeyDown={(e) => e.key === 'Enter' && launch(device.id, 'recycle')}
            className="flex w-20 flex-col items-center gap-1 rounded-sm p-1.5 text-[11px] text-white hover:bg-white/15 focus:bg-[#cce8ff]/30 focus:outline-none"
            title="Corbeille (double-clic)"
            data-testid="desktop-icon-recycle"
          >
            <Trash2 size={30} strokeWidth={1.3} className="text-slate-100 drop-shadow" />
            <span className="drop-shadow">Corbeille</span>
          </button>
        </div>

        {windows.map((win) => {
          const app = appInfo(win.app)
          if (!app) return null
          const blocked = windows.some((w) => w.parent === win.id)
          return (
            <AppWindow
              key={win.id}
              deviceId={device.id}
              win={win}
              app={app}
              title={app.title?.(device, win.arg) ?? app.label}
              active={active?.id === win.id}
              blocked={blocked}
              area={area}
            >
              {renderApp(win, device)}
            </AppWindow>
          )
        })}

        {menu && <div className="absolute inset-0 z-[8999]" onPointerDown={closeMenu} />}
        {menu === 'start' && <StartMenu device={device} onClose={closeMenu} onPower={power} />}
        {menu === 'winx' && (
          <WinXMenu device={device} onClose={closeMenu} onPower={power} onSearch={() => setMenu('search')} />
        )}
        {menu === 'search' && (
          <SearchPanel
            device={device}
            query={query}
            onClose={() => {
              setQuery('')
              closeMenu()
            }}
          />
        )}
        {menu === 'network' && <NetworkFlyout device={device} onClose={closeMenu} />}

        {desktop?.notice && (
          <MessageBox
            title={desktop.notice.title}
            message={desktop.notice.message}
            icon={desktop.notice.kind}
            buttons={[
              {
                label: 'OK',
                primary: true,
                onClick: () => store.showNotice(device.id, null),
                testId: 'notice-ok'
              }
            ]}
            testId="desktop-notice"
          />
        )}

        {shutdown && (
          <div className="absolute inset-0 z-[9500] flex items-center justify-center bg-black/30">
            <div
              className="w-[420px] bg-[#f0f0f0] text-xs text-black shadow-2xl"
              data-testid="shutdown-dialog"
            >
              <div className="bg-[#0063b1] px-4 py-3 text-sm text-white">
                {shutdown === 'restart' ? 'Redémarrer' : 'Arrêter'} {device.name}
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p>Choisissez une raison qui décrit le mieux pourquoi vous voulez arrêter cet ordinateur.</p>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="h-6 border border-[#7a7a7a] bg-white px-1"
                  data-testid="shutdown-reason"
                >
                  {REASONS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 px-4 pb-4">
                <WinButton primary onClick={confirmShutdown} data-testid="shutdown-continue">
                  Continuer
                </WinButton>
                <WinButton onClick={() => setShutdown(null)}>Annuler</WinButton>
              </div>
            </div>
          </div>
        )}
      </div>
      <Taskbar
        device={device}
        menu={menu}
        setMenu={setMenu}
        query={query}
        setQuery={setQuery}
        onSearchEnter={() => {
          submitSearch(device, query)
          setQuery('')
          closeMenu()
        }}
      />
    </div>
  )
}
