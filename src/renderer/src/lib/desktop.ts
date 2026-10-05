/**
 * Lancement des applications du Bureau simulé (menu Démarrer, Exécuter, Gestionnaire de serveur…).
 * Vérifie la disponibilité de l'application avant d'ouvrir la fenêtre.
 */
import { isHostDevice } from '@engine/index'
import { appByCommand, appInfo } from '../components/desktop/apps'
import { useDesktopStore } from '../store/desktop'
import { useLabStore } from '../store/lab'
import { isRestricted, RESTRICTION_MESSAGE, RESTRICTION_TITLE } from './policy'

/** Taille de la zone de bureau de chaque ordinateur (mesurée par le Bureau affiché). */
const areas = new Map<string, { w: number; h: number }>()

export function setDesktopArea(deviceId: string, size: { w: number; h: number }): void {
  areas.set(deviceId, size)
}

export interface LaunchOptions {
  arg?: string
  /** Fenêtre parente (boîte de dialogue modale). */
  parent?: string
}

/** Ouvre une application sur le Bureau d'un ordinateur ; renvoie l'identifiant de fenêtre. */
export function launch(deviceId: string, appId: string, options: LaunchOptions = {}): string | null {
  const device = useLabStore.getState().lab.devices[deviceId]
  const app = appInfo(appId)
  const desktop = useDesktopStore.getState()
  if (!device || !isHostDevice(device) || !app) return null
  if (!app.available(device)) {
    desktop.showNotice(deviceId, {
      title: app.label,
      message: `${app.label} n’est pas disponible sur cet ordinateur.`,
      kind: 'warning'
    })
    return null
  }
  // Stratégie de groupe de l'utilisateur (Panneau de configuration, Exécuter…)
  if (isRestricted(device, app)) {
    desktop.showNotice(deviceId, { title: RESTRICTION_TITLE, message: RESTRICTION_MESSAGE, kind: 'error' })
    return null
  }
  return desktop.open(deviceId, {
    app: appId,
    ...(options.arg !== undefined ? { arg: options.arg } : {}),
    ...(options.parent !== undefined ? { parent: options.parent } : {}),
    size: app.size,
    maximized: !!app.maximized,
    area: areas.get(deviceId) ?? { w: 960, h: 560 }
  })
}

/**
 * Commande saisie dans Exécuter ou la recherche : application connue (ncpa.cpl, dsa.msc…).
 * Renvoie faux si la commande est introuvable (message système affiché).
 */
export function runCommand(deviceId: string, command: string): boolean {
  const text = command.trim()
  if (!text) return false
  const app = appByCommand(text)
  if (app) return launch(deviceId, app.id) !== null
  if (/^gpedit(\.msc)?$/i.test(text)) {
    useDesktopStore.getState().showNotice(deviceId, {
      title: 'Éditeur de stratégie de groupe locale',
      message:
        'La stratégie de groupe locale n’est pas simulée. Sur un contrôleur de domaine, utilisez la console Gestion des stratégies de groupe (gpmc.msc).',
      kind: 'info'
    })
    return false
  }
  useDesktopStore.getState().showNotice(deviceId, {
    title: text,
    message: `Impossible de trouver « ${text} ». Vérifiez que vous avez correctement entré le nom, puis réessayez.`,
    kind: 'error'
  })
  return false
}
