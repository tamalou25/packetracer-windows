/**
 * Câblage port à port : premier port choisi, puis second port → câble créé dans le moteur.
 * Utilisé par le menu de ports et par le panneau de ports affiché au survol des nœuds.
 */
import { connect } from '@engine/index'
import { useUiStore } from '../store/ui'
import { runAction } from './run'

/** Choisit un port pendant le câblage (outil Câble). */
export function pickCablePort(deviceId: string, ifaceId: string): void {
  const ui = useUiStore.getState()
  const end = { deviceId, ifaceId }
  const start = ui.cableStart
  if (!start) {
    ui.setCableStart(end)
    return
  }
  // Second clic sur le même équipement : on change simplement de port de départ
  if (start.deviceId === deviceId) {
    ui.setCableStart(end)
    return
  }
  ui.setCableStart(null)
  const linkId = runAction((lab) => connect(lab, start, end))
  if (linkId) ui.select({ link: linkId, devices: [] })
}
