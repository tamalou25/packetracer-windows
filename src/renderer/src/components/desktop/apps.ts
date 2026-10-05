/**
 * Métadonnées des applications du Bureau (les composants sont associés dans DesktopTab).
 */
import {
  LayoutDashboard,
  Monitor,
  Network,
  ScrollText,
  SquareTerminal,
  TerminalSquare,
  Waypoints,
  type LucideIcon
} from 'lucide-react'
import type { HostDevice } from '@engine/index'

export interface DesktopAppInfo {
  id: string
  label: string
  icon: LucideIcon
  /** Couleur de la tuile. */
  color: string
  /** Outil d'administration (menu Outils du Gestionnaire de serveur). */
  tool?: boolean
  available: (device: HostDevice) => boolean
}

const has = (device: HostDevice, feature: string) => device.host.features.includes(feature)

export const DESKTOP_APPS: DesktopAppInfo[] = [
  {
    id: 'servermanager',
    label: 'Gestionnaire de serveur',
    icon: LayoutDashboard,
    color: 'bg-sky-700',
    available: (d) => d.kind === 'server'
  },
  {
    id: 'cmd',
    label: 'Invite de commandes',
    icon: TerminalSquare,
    color: 'bg-neutral-800',
    available: () => true
  },
  {
    id: 'powershell',
    label: 'PowerShell',
    icon: SquareTerminal,
    color: 'bg-[#012456]',
    available: () => true
  },
  {
    id: 'network',
    label: 'Paramètres réseau',
    icon: Network,
    color: 'bg-emerald-700',
    available: () => true
  },
  { id: 'system', label: 'Système', icon: Monitor, color: 'bg-indigo-700', available: () => true },
  {
    id: 'dhcp',
    label: 'DHCP',
    icon: Waypoints,
    color: 'bg-teal-700',
    tool: true,
    available: (d) => has(d, 'RSAT-DHCP')
  },
  {
    id: 'events',
    label: 'Observateur d’événements',
    icon: ScrollText,
    color: 'bg-amber-700',
    tool: true,
    available: () => true
  }
]

export function appInfo(id: string): DesktopAppInfo | undefined {
  return DESKTOP_APPS.find((a) => a.id === id)
}
