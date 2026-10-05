/**
 * Applications du Bureau simulé : métadonnées (titre, icône, taille, commande Exécuter,
 * place dans le menu Démarrer…). Les composants sont associés dans renderApp.tsx.
 */
import {
  EthernetPort,
  Globe,
  Monitor,
  Network,
  PackagePlus,
  Play,
  ScrollText,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
  SquareTerminal,
  TerminalSquare,
  Trash2,
  UsersRound,
  Waypoints,
  type LucideIcon
} from 'lucide-react'
import type { HostDevice } from '@engine/index'

export interface DesktopApp {
  id: string
  label: string
  icon: LucideIcon
  /** Couleur de l'icône (barre des tâches, menus, barre de titre). */
  color: string
  /** Taille par défaut de la fenêtre. */
  size: { w: number; h: number }
  /** Ouverte agrandie (Gestionnaire de serveur). */
  maximized?: boolean
  /** Boîte de dialogue : taille fixe, pas de bouton Agrandir. */
  dialog?: boolean
  /** Commandes reconnues par la boîte Exécuter et la recherche (en minuscules). */
  run?: string[]
  /** Place dans le menu Démarrer. */
  start?: 'top' | 'admin' | 'system'
  /** Outil d'administration (menu Outils du Gestionnaire de serveur). */
  tool?: boolean
  /** Épinglée dans la barre des tâches. */
  pinned?: (device: HostDevice) => boolean
  /** Élément du Panneau de configuration (concerné par les restrictions de stratégie). */
  controlPanel?: boolean
  available: (device: HostDevice) => boolean
  /** Titre de la fenêtre si différent du libellé (ex. nom de la carte réseau). */
  title?: (device: HostDevice, arg?: string) => string
}

const has = (device: HostDevice, feature: string) => device.host.features.includes(feature)
const isServer = (device: HostDevice) => device.kind === 'server'
const always = () => true

/** Nom de la carte réseau passée en paramètre. */
function ifaceName(device: HostDevice, arg?: string): string {
  return device.interfaces.find((i) => i.id === arg)?.name ?? 'Ethernet'
}

export const DESKTOP_APPS: DesktopApp[] = [
  {
    id: 'servermanager',
    label: 'Gestionnaire de serveur',
    icon: ServerCog,
    color: 'text-sky-500',
    size: { w: 1000, h: 680 },
    maximized: true,
    run: ['servermanager', 'servermanager.exe'],
    start: 'top',
    pinned: isServer,
    available: isServer
  },
  {
    id: 'powershell',
    label: 'PowerShell',
    icon: SquareTerminal,
    color: 'text-blue-500',
    size: { w: 740, h: 440 },
    run: ['powershell', 'powershell.exe'],
    start: 'top',
    pinned: always,
    available: always
  },
  {
    id: 'cmd',
    label: 'Invite de commandes',
    icon: TerminalSquare,
    color: 'text-neutral-400',
    size: { w: 700, h: 420 },
    run: ['cmd', 'cmd.exe'],
    start: 'system',
    pinned: (d) => d.kind === 'client',
    available: always
  },
  {
    id: 'ncpa',
    label: 'Connexions réseau',
    icon: Network,
    color: 'text-emerald-500',
    size: { w: 660, h: 400 },
    run: ['ncpa.cpl', 'control netconnections'],
    start: 'system',
    controlPanel: true,
    available: always
  },
  {
    id: 'netstatus',
    label: 'État de la connexion',
    icon: EthernetPort,
    color: 'text-emerald-500',
    size: { w: 380, h: 450 },
    dialog: true,
    title: (d, arg) => `État de ${ifaceName(d, arg)}`,
    available: always
  },
  {
    id: 'netprops',
    label: 'Propriétés de la connexion',
    icon: EthernetPort,
    color: 'text-emerald-500',
    size: { w: 390, h: 470 },
    dialog: true,
    title: (d, arg) => `Propriétés de ${ifaceName(d, arg)}`,
    available: always
  },
  {
    id: 'netdetails',
    label: 'Détails de connexion réseau',
    icon: EthernetPort,
    color: 'text-emerald-500',
    size: { w: 420, h: 420 },
    dialog: true,
    available: always
  },
  {
    id: 'ipv4',
    label: 'Propriétés de : Protocole Internet version 4 (TCP/IPv4)',
    icon: EthernetPort,
    color: 'text-emerald-500',
    size: { w: 430, h: 500 },
    dialog: true,
    available: always
  },
  {
    id: 'sysdm',
    label: 'Propriétés système',
    icon: Monitor,
    color: 'text-indigo-400',
    size: { w: 430, h: 480 },
    dialog: true,
    run: ['sysdm.cpl', 'control sysdm.cpl', 'system'],
    start: 'system',
    controlPanel: true,
    available: always
  },
  {
    id: 'sysdmname',
    label: 'Modification du nom ou du domaine de l’ordinateur',
    icon: Monitor,
    color: 'text-indigo-400',
    size: { w: 380, h: 460 },
    dialog: true,
    available: always
  },
  {
    id: 'control',
    label: 'Panneau de configuration',
    icon: SlidersHorizontal,
    color: 'text-sky-400',
    size: { w: 780, h: 520 },
    run: ['control', 'control.exe', 'control panel'],
    start: 'system',
    controlPanel: true,
    available: always
  },
  {
    id: 'eventvwr',
    label: 'Observateur d’événements',
    icon: ScrollText,
    color: 'text-amber-500',
    size: { w: 920, h: 580 },
    run: ['eventvwr', 'eventvwr.msc', 'eventvwr.exe'],
    start: 'admin',
    tool: true,
    available: always
  },
  {
    id: 'dhcp',
    label: 'DHCP',
    icon: Waypoints,
    color: 'text-teal-500',
    size: { w: 920, h: 580 },
    run: ['dhcpmgmt.msc'],
    start: 'admin',
    tool: true,
    available: (d) => has(d, 'RSAT-DHCP')
  },
  {
    id: 'dns',
    label: 'DNS',
    icon: Globe,
    color: 'text-sky-500',
    size: { w: 920, h: 580 },
    run: ['dnsmgmt.msc'],
    start: 'admin',
    tool: true,
    available: (d) => has(d, 'RSAT-DNS-Server')
  },
  {
    id: 'aduc',
    label: 'Utilisateurs et ordinateurs Active Directory',
    icon: UsersRound,
    color: 'text-indigo-400',
    size: { w: 940, h: 600 },
    run: ['dsa.msc'],
    start: 'admin',
    tool: true,
    available: (d) => has(d, 'RSAT-ADDS') && !!d.host.domain
  },
  {
    id: 'run',
    label: 'Exécuter',
    icon: Play,
    color: 'text-sky-400',
    size: { w: 410, h: 220 },
    dialog: true,
    start: 'system',
    available: always
  },
  {
    id: 'addroles',
    label: 'Assistant Ajout de rôles et de fonctionnalités',
    icon: PackagePlus,
    color: 'text-sky-500',
    size: { w: 800, h: 580 },
    title: (_d, arg) =>
      arg === 'remove'
        ? 'Assistant Suppression de rôles et de fonctionnalités'
        : 'Assistant Ajout de rôles et de fonctionnalités',
    available: isServer
  },
  {
    id: 'adpromote',
    label: 'Assistant Configuration des services de domaine Active Directory',
    icon: ShieldCheck,
    color: 'text-indigo-400',
    size: { w: 800, h: 580 },
    available: isServer
  },
  {
    id: 'dhcppost',
    label: 'Assistant Configuration post-installation DHCP',
    icon: Waypoints,
    color: 'text-teal-500',
    size: { w: 660, h: 470 },
    available: isServer
  },
  {
    id: 'recycle',
    label: 'Corbeille',
    icon: Trash2,
    color: 'text-slate-400',
    size: { w: 640, h: 400 },
    available: always
  }
]

export function appInfo(id: string): DesktopApp | undefined {
  return DESKTOP_APPS.find((a) => a.id === id)
}

/** Recherche une application par commande Exécuter (ncpa.cpl, dsa.msc…). */
export function appByCommand(command: string): DesktopApp | undefined {
  const c = command.trim().toLowerCase().replace(/\s+/g, ' ')
  return DESKTOP_APPS.find((a) => a.run?.includes(c))
}
