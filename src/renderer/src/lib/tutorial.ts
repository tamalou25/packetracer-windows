/**
 * Tutoriel « premier ping » : démarrage sur un lab vide, réponses d'écho observées (console et
 * outil PDU) et zones de l'interface à mettre en évidence pour l'étape en cours. La validation
 * des étapes est faite par le moteur (`tutorialProgress`) sur l'état réel du lab.
 */
import { echoRepliesDelivered, type PacketTrace, type TutorialProgress } from '@engine/index'
import { useLabStore } from '../store/lab'
import { useTutorialStore } from '../store/tutorial'
import type { DeviceWindowState, UiState } from '../store/ui'
import { newDocument } from './document'

/** Affiche la carte de bienvenue du tutoriel (Aide > Tutoriel interactif, démarrage). */
export function offerTutorial(): void {
  useTutorialStore.getState().offer()
}

/** « Commencer » : nouveau lab vide (après « Enregistrer ? » si besoin), puis première étape. */
export async function startTutorial(): Promise<void> {
  if (!(await newDocument())) return
  useTutorialStore.getState().begin(useLabStore.getState().revision)
}

/** Passer ou quitter le tutoriel (relançable depuis Aide > Tutoriel interactif). */
export function closeTutorial(): void {
  useTutorialStore.getState().close()
}

/** Parcours réussi : le tutoriel n'est plus proposé au démarrage. */
export function completeTutorial(): void {
  useTutorialStore.getState().finish()
  window.serverlab.setTutorialAtStartup(false)
}

export function setTutorialAtStartup(show: boolean): void {
  window.serverlab.setTutorialAtStartup(show)
}

/**
 * Trace d'une opération réseau terminée (console ou PDU) : les réponses d'écho reçues prouvent
 * qu'un ping a réellement eu lieu. Sans effet hors tutoriel.
 */
export function observeTrace(trace: PacketTrace | null | undefined): void {
  const store = useTutorialStore.getState()
  if (store.phase !== 'running') return
  const echoes = echoRepliesDelivered(trace)
  if (echoes.length > 0) store.addEchoes(echoes)
}

const byTestId = (id: string) => `[data-testid="${CSS.escape(id)}"]`
const inWindow = (name: string, id: string) => `${byTestId(`device-window-${name}`)} ${byTestId(id)}`

/**
 * Zones à mettre en évidence pour l'étape en cours, par ordre de préférence (sélecteurs CSS) :
 * la première présente à l'écran est entourée. Elles suivent les actions de l'utilisateur
 * (équipement armé, outil Câble, fenêtre ouverte, onglet affiché).
 */
export function tutorialTargets(
  progress: TutorialProgress,
  ui: Pick<UiState, 'armed' | 'tool' | 'cableStart'> & { windows: DeviceWindowState[] }
): string[] {
  const { server, client } = progress
  const opened = (id: string | undefined) => ui.windows.some((w) => w.deviceId === id)
  switch (progress.current) {
    case 'place-server':
      return [byTestId(ui.armed === 'server' ? 'topology-canvas' : 'palette-server')]
    case 'place-client':
      return [byTestId(ui.armed === 'client' ? 'topology-canvas' : 'palette-client')]
    case 'cable': {
      if (ui.tool !== 'cable' || !server || !client) return [byTestId('tool-cable')]
      const next = ui.cableStart?.deviceId === server.id ? client : server
      return [byTestId('port-picker'), byTestId(`device-${next.name}`)]
    }
    case 'ip-server':
    case 'ip-client': {
      const host = progress.current === 'ip-server' ? server : client
      if (!host) return []
      if (!opened(host.id)) return [byTestId(`device-${host.name}`)]
      return [
        inWindow(host.name, 'ip-address'),
        inWindow(host.name, 'nav-iface-Ethernet0'),
        inWindow(host.name, 'tab-config')
      ]
    }
    case 'ping': {
      if (!client) return []
      if (!opened(client.id)) return [byTestId(`device-${client.name}`)]
      return [inWindow(client.name, 'terminal-input'), inWindow(client.name, 'tab-console')]
    }
    default:
      return []
  }
}
