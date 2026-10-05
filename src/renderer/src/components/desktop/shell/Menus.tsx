/**
 * Menus du Bureau simulé : menu Démarrer (liste alphabétique, dossiers, vignettes, alimentation),
 * menu d'administration (clic droit sur Démarrer), résultats de recherche, volet réseau.
 */
import { useState, type ReactNode } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  Lock,
  LogOut,
  Menu,
  Power,
  RotateCcw,
  Settings,
  UserRound
} from 'lucide-react'
import type { HostDevice } from '@engine/index'
import { launch, runCommand } from '../../../lib/desktop'
import { hostNetwork } from '../../../lib/netstatus'
import { runRemoved } from '../../../lib/policy'
import { useDesktopStore } from '../../../store/desktop'
import { useLabStore } from '../../../store/lab'
import { DESKTOP_APPS, type DesktopApp } from '../apps'
import { NetworkGlyph } from './Taskbar'

export type PowerAction = 'lock' | 'logoff' | 'restart' | 'shutdown'

const panel =
  'absolute bottom-10 z-[9000] bg-[#2b2b2b]/[0.97] text-white shadow-[0_0_24px_rgba(0,0,0,0.5)] backdrop-blur'

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Applications correspondant à une recherche (nom ou commande Exécuter). */
export function searchApps(device: HostDevice, query: string): DesktopApp[] {
  const q = normalize(query.trim())
  if (!q) return []
  return DESKTOP_APPS.filter(
    (a) =>
      a.available(device) &&
      (a.start || a.tool || a.run) &&
      (normalize(a.label).includes(q) || (a.run ?? []).some((r) => r.startsWith(q)))
  ).sort((a, b) => {
    // Commande exacte ou début du nom en premier
    const score = (x: DesktopApp) =>
      (x.run ?? []).includes(q) ? 0 : normalize(x.label).startsWith(q) ? 1 : 2
    return score(a) - score(b)
  })
}

interface StartMenuProps {
  device: HostDevice
  onClose: () => void
  onPower: (action: PowerAction) => void
}

function RailButton({
  icon: Icon,
  label,
  onClick,
  testId,
  active
}: {
  icon: typeof Power
  label: string
  onClick: () => void
  testId?: string
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      data-testid={testId}
      className={`flex h-11 w-12 items-center justify-center hover:bg-white/10 ${active ? 'bg-white/15' : ''}`}
    >
      <Icon size={17} strokeWidth={1.6} />
    </button>
  )
}

function Popover({ children }: { children: ReactNode }) {
  return (
    <div className="absolute bottom-0 left-12 z-10 w-48 border border-white/10 bg-[#2b2b2b] py-1 text-sm shadow-xl">
      {children}
    </div>
  )
}

function PopoverItem({
  icon: Icon,
  label,
  onClick,
  testId
}: {
  icon: typeof Power
  label: string
  onClick: () => void
  testId: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/10"
    >
      <Icon size={15} /> {label}
    </button>
  )
}

const TILES: Record<HostDevice['kind'], { id: string; wide?: boolean }[]> = {
  server: [
    { id: 'servermanager', wide: true },
    { id: 'powershell' },
    { id: 'cmd' },
    { id: 'control' },
    { id: 'eventvwr' },
    { id: 'ncpa' }
  ],
  client: [
    { id: 'control', wide: true },
    { id: 'cmd' },
    { id: 'powershell' },
    { id: 'ncpa' },
    { id: 'sysdm' }
  ]
}

export function StartMenu({ device, onClose, onPower }: StartMenuProps) {
  const [popover, setPopover] = useState<'user' | 'power' | null>(null)
  const [open, setOpen] = useState<string[]>([])
  const session = device.host.session
  const go = (appId: string) => {
    onClose()
    launch(device.id, appId)
  }
  // « Exécuter » retiré par stratégie de groupe
  const available = DESKTOP_APPS.filter((a) => a.available(device) && !(a.id === 'run' && runRemoved(device)))
  const folders = [
    {
      id: 'admin',
      label: 'Outils d’administration',
      apps: available.filter((a) => a.start === 'admin' || (a.tool && a.start !== 'top'))
    },
    { id: 'system', label: 'Système', apps: available.filter((a) => a.start === 'system') }
  ].filter((f) => f.apps.length > 0)
  const entries = [
    ...available.filter((a) => a.start === 'top').map((a) => ({ key: a.id, label: a.label, app: a })),
    ...folders.map((f) => ({ key: `folder-${f.id}`, label: f.label, folder: f }))
  ].sort((a, b) => a.label.localeCompare(b.label, 'fr'))
  let lastLetter = ''

  return (
    <div
      className={`${panel} left-0 flex h-[min(520px,calc(100%-48px))] w-[620px] max-w-full`}
      data-testid="start-menu"
    >
      <div className="relative flex w-12 shrink-0 flex-col justify-between py-1">
        <RailButton icon={Menu} label="Développer" onClick={() => undefined} />
        <div>
          <RailButton
            icon={UserRound}
            label={session ? `${session.domain ?? device.name}\\${session.user}` : 'Utilisateur'}
            onClick={() => setPopover(popover === 'user' ? null : 'user')}
            testId="start-user"
            active={popover === 'user'}
          />
          <RailButton
            icon={Settings}
            label="Paramètres"
            onClick={() => go('control')}
            testId="start-settings"
          />
          <RailButton
            icon={Power}
            label="Marche/Arrêt"
            onClick={() => setPopover(popover === 'power' ? null : 'power')}
            testId="start-power"
            active={popover === 'power'}
          />
        </div>
        {popover === 'user' && (
          <Popover>
            <PopoverItem icon={Lock} label="Verrouiller" onClick={() => onPower('lock')} testId="user-lock" />
            <PopoverItem
              icon={LogOut}
              label="Se déconnecter"
              onClick={() => onPower('logoff')}
              testId="logoff"
            />
          </Popover>
        )}
        {popover === 'power' && (
          <Popover>
            <PopoverItem
              icon={Power}
              label="Arrêter"
              onClick={() => onPower('shutdown')}
              testId="power-shutdown"
            />
            <PopoverItem
              icon={RotateCcw}
              label="Redémarrer"
              onClick={() => onPower('restart')}
              testId="power-restart"
            />
          </Popover>
        )}
      </div>
      <div className="w-[230px] shrink-0 overflow-y-auto py-2 text-[13px]">
        {entries.map((entry) => {
          const letter = normalize(entry.label).charAt(0).toUpperCase()
          const header = letter !== lastLetter
          lastLetter = letter
          return (
            <div key={entry.key}>
              {header && <div className="px-3 pt-2 pb-1 text-xs text-white/70">{letter}</div>}
              {'app' in entry && entry.app ? (
                <button
                  type="button"
                  onClick={() => go(entry.app.id)}
                  className="flex w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-white/10"
                  data-testid={`start-app-${entry.app.id}`}
                >
                  <entry.app.icon size={18} className={entry.app.color} /> {entry.app.label}
                </button>
              ) : 'folder' in entry && entry.folder ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setOpen(
                        open.includes(entry.folder.id)
                          ? open.filter((f) => f !== entry.folder.id)
                          : [...open, entry.folder.id]
                      )
                    }
                    className="flex w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-white/10"
                    data-testid={`start-folder-${entry.folder.id}`}
                  >
                    <Folder size={18} className="text-amber-300" />
                    <span className="flex-1">{entry.folder.label}</span>
                    {open.includes(entry.folder.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  {open.includes(entry.folder.id) &&
                    entry.folder.apps.map((app) => (
                      <button
                        key={app.id}
                        type="button"
                        onClick={() => go(app.id)}
                        className="flex w-full items-center gap-3 py-1.5 pr-3 pl-9 text-left hover:bg-white/10"
                        data-testid={`start-app-${app.id}`}
                      >
                        <app.icon size={16} className={app.color} /> {app.label}
                      </button>
                    ))}
                </>
              ) : null}
            </div>
          )
        })}
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto p-3">
        <div className="mb-2 text-xs text-white/80">
          {device.kind === 'server' ? 'Serveur' : 'Productivité'}
        </div>
        <div className="grid grid-cols-[repeat(3,96px)] gap-1">
          {TILES[device.kind].map(({ id, wide }) => {
            const app = available.find((a) => a.id === id)
            if (!app) return null
            return (
              <button
                key={id}
                type="button"
                onClick={() => go(id)}
                className={`relative flex h-[96px] flex-col justify-between bg-[#0063b1] p-2 text-left hover:outline hover:outline-2 hover:outline-white/40 ${wide ? 'col-span-2' : ''}`}
                data-testid={`start-tile-${id}`}
              >
                <app.icon size={wide ? 30 : 26} strokeWidth={1.4} className="text-white" />
                <span className="text-[11px] leading-tight">{app.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Menu d'administration (clic droit sur le bouton Démarrer). */
export function WinXMenu({ device, onClose, onPower, onSearch }: StartMenuProps & { onSearch: () => void }) {
  const [shutdown, setShutdown] = useState(false)
  const item = (label: string, onClick: () => void, testId: string, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center justify-between px-4 py-1.5 text-left text-[13px] hover:bg-white/10 disabled:text-white/40 disabled:hover:bg-transparent"
      data-testid={`winx-${testId}`}
    >
      {label}
    </button>
  )
  const open = (appId: string) => () => {
    onClose()
    launch(device.id, appId)
  }
  const can = (appId: string) => DESKTOP_APPS.find((a) => a.id === appId)?.available(device) ?? false
  return (
    <div className={`${panel} left-0 w-64 py-1`} data-testid="winx-menu">
      {item('Observateur d’événements', open('eventvwr'), 'eventvwr')}
      {item('Système', open('sysdm'), 'sysdm')}
      {item('Connexions réseau', open('ncpa'), 'ncpa')}
      {device.kind === 'server' &&
        item('Gestionnaire de serveur', open('servermanager'), 'servermanager', !can('servermanager'))}
      <div className="my-1 border-t border-white/15" />
      {item('PowerShell', open('powershell'), 'powershell')}
      {item('PowerShell (admin)', open('powershell'), 'powershell-admin')}
      {item('Invite de commandes', open('cmd'), 'cmd')}
      <div className="my-1 border-t border-white/15" />
      {item('Panneau de configuration', open('control'), 'control')}
      {item('Rechercher', onSearch, 'search')}
      {!runRemoved(device) && item('Exécuter', open('run'), 'run')}
      <div className="my-1 border-t border-white/15" />
      <div className="relative">
        {item('Arrêter ou se déconnecter  ›', () => setShutdown(!shutdown), 'shutdown')}
        {shutdown && (
          <div className="absolute bottom-0 left-full w-48 border border-white/10 bg-[#2b2b2b] py-1 shadow-xl">
            {item('Se déconnecter', () => onPower('logoff'), 'logoff')}
            {item('Arrêter', () => onPower('shutdown'), 'power-shutdown')}
            {item('Redémarrer', () => onPower('restart'), 'power-restart')}
          </div>
        )}
      </div>
      {item(
        'Bureau',
        () => {
          onClose()
          useDesktopStore.getState().minimizeAll(device.id)
        },
        'desktop'
      )}
    </div>
  )
}

/** Résultats de recherche (zone de recherche de la barre des tâches). */
export function SearchPanel({
  device,
  query,
  onClose
}: {
  device: HostDevice
  query: string
  onClose: () => void
}) {
  const results = searchApps(device, query)
  const best = results[0]
  return (
    <div className={`${panel} left-12 w-[420px] p-3`} data-testid="search-panel">
      {query.trim() === '' ? (
        <p className="text-xs text-white/70">
          Tapez le nom d’une application ou une commande (ncpa.cpl, dsa.msc, dnsmgmt.msc…).
        </p>
      ) : best ? (
        <>
          <div className="mb-1 text-xs text-white/70">Meilleur résultat</div>
          <button
            type="button"
            onClick={() => {
              onClose()
              launch(device.id, best.id)
            }}
            className="mb-2 flex w-full items-center gap-3 bg-white/15 p-2 text-left hover:bg-white/25"
            data-testid={`search-result-${best.id}`}
          >
            <best.icon size={28} className={best.color} />
            <span>
              <span className="block text-sm">{best.label}</span>
              <span className="block text-xs text-white/70">{best.run?.[0] ?? 'Application'}</span>
            </span>
          </button>
          {results.slice(1).map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                onClose()
                launch(device.id, a.id)
              }}
              className="flex w-full items-center gap-3 px-2 py-1.5 text-left text-sm hover:bg-white/10"
              data-testid={`search-result-${a.id}`}
            >
              <a.icon size={16} className={a.color} /> {a.label}
            </button>
          ))}
        </>
      ) : (
        <p className="text-xs text-white/80">
          Aucun résultat pour « {query} ». Appuyez sur Entrée pour l’exécuter comme une commande.
        </p>
      )}
    </div>
  )
}

/** Lance la recherche (Entrée dans la zone de recherche) : meilleur résultat ou commande. */
export function submitSearch(device: HostDevice, query: string): void {
  const best = searchApps(device, query)[0]
  if (best) launch(device.id, best.id)
  else runCommand(device.id, query)
}

/** Volet réseau de la zone de notification. */
export function NetworkFlyout({ device, onClose }: { device: HostDevice; onClose: () => void }) {
  const lab = useLabStore((s) => s.lab)
  const net = hostNetwork(lab, device)
  return (
    <div className={`${panel} right-0 w-80 p-3`} data-testid="network-flyout">
      {net.adapters.map((a) => (
        <div key={a.iface.id} className="mb-2 flex items-start gap-3 bg-white/10 p-2.5">
          <NetworkGlyph state={a.state} size={20} />
          <div className="min-w-0 text-[13px]">
            <div className="truncate font-medium">
              {a.state === 'unplugged' || a.state === 'disabled' ? a.iface.name : a.network}
            </div>
            <div className="text-xs text-white/75">
              {a.state === 'internet'
                ? 'Connecté'
                : a.state === 'local'
                  ? 'Pas d’accès Internet'
                  : a.state === 'no-network'
                    ? 'Pas d’accès réseau'
                    : a.label}
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          onClose()
          launch(device.id, 'ncpa')
        }}
        className="mt-1 text-xs text-[#99ebff] hover:underline"
        data-testid="network-settings"
      >
        Paramètres réseau et Internet
      </button>
    </div>
  )
}
