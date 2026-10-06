/**
 * Apparence des vues déclarées par les modules de rôles (`RoleModule.views` du moteur) : icône,
 * couleur, taille de fenêtre ; icône de chaque rôle dans le Gestionnaire de serveur. Le moteur décrit la vue (titre, commande Exécuter, disponibilité),
 * l'interface l'habille ; le composant est associé dans renderApp.tsx.
 */
import {
  AppWindow,
  Archive,
  ArchiveRestore,
  BadgeCheck,
  CloudDownload,
  FileCog,
  FolderCog,
  FolderSymlink,
  FolderTree,
  Globe,
  Earth,
  HardDrive,
  Layers,
  MonitorSmartphone,
  ScrollText,
  Server,
  RefreshCw,
  ShieldCheck,
  UsersRound,
  Waypoints,
  type LucideIcon
} from 'lucide-react'
import type { DesktopApp } from './apps'

type ViewStyle = Pick<DesktopApp, 'icon' | 'color' | 'size'> & Partial<Pick<DesktopApp, 'title' | 'start'>>

const STYLES: Record<string, ViewStyle> = {
  dhcp: { icon: Waypoints, color: 'text-teal-500', size: { w: 920, h: 580 } },
  dhcppost: { icon: Waypoints, color: 'text-teal-500', size: { w: 660, h: 470 } },
  dns: { icon: Globe, color: 'text-sky-500', size: { w: 920, h: 580 } },
  aduc: { icon: UsersRound, color: 'text-indigo-400', size: { w: 940, h: 600 } },
  dsac: { icon: ArchiveRestore, color: 'text-indigo-500', size: { w: 900, h: 560 } },
  adpromote: { icon: ShieldCheck, color: 'text-indigo-400', size: { w: 800, h: 580 } },
  gpmc: { icon: ScrollText, color: 'text-amber-600', size: { w: 980, h: 620 } },
  gpme: { icon: FileCog, color: 'text-amber-600', size: { w: 980, h: 600 } },
  fileprops: {
    icon: FolderCog,
    color: 'text-amber-500',
    size: { w: 440, h: 560 },
    title: (_d, arg) => `Propriétés de : ${arg?.replace(/\\$/, '').split('\\').pop() || arg || ''}`
  },
  newshare: { icon: FolderSymlink, color: 'text-amber-500', size: { w: 520, h: 470 } },
  wsus: { icon: CloudDownload, color: 'text-emerald-600', size: { w: 980, h: 600 } },
  wbadmin: { icon: Archive, color: 'text-emerald-700', size: { w: 900, h: 560 } },
  dfsmgmt: { icon: FolderTree, color: 'text-amber-600', size: { w: 980, h: 600 } },
  certsrv: { icon: BadgeCheck, color: 'text-emerald-700', size: { w: 960, h: 580 } },
  hypervmgr: { icon: Layers, color: 'text-sky-700', size: { w: 980, h: 600 } },
  rdsmgr: { icon: MonitorSmartphone, color: 'text-violet-600', size: { w: 900, h: 560 } },
  mstsc: {
    icon: MonitorSmartphone,
    color: 'text-sky-600',
    size: { w: 460, h: 470 },
    start: 'system'
  },
  inetmgr: { icon: Earth, color: 'text-sky-600', size: { w: 960, h: 600 } },
  browser: { icon: Globe, color: 'text-sky-500', size: { w: 820, h: 560 }, start: 'top' },
  wuclient: { icon: RefreshCw, color: 'text-sky-600', size: { w: 640, h: 520 }, start: 'system' }
}

/** Apparence par défaut d'une vue de rôle sans style dédié. */
const DEFAULT_STYLE: ViewStyle = { icon: AppWindow, color: 'text-slate-400', size: { w: 800, h: 560 } }

export function roleViewStyle(app: string): ViewStyle {
  return STYLES[app] ?? DEFAULT_STYLE
}

/** Icône d'un rôle (vignettes et navigation du Gestionnaire de serveur), par identifiant de module. */
const ROLE_ICONS: Record<string, LucideIcon> = {
  adcs: BadgeCheck,
  adds: UsersRound,
  backup: Archive,
  dfs: FolderTree,
  dhcp: Waypoints,
  dns: Globe,
  files: HardDrive,
  gpo: ScrollText,
  hyperv: Layers,
  iis: Earth,
  rds: MonitorSmartphone,
  wsus: CloudDownload
}

export function roleIcon(roleId: string): LucideIcon {
  return ROLE_ICONS[roleId] ?? Server
}
