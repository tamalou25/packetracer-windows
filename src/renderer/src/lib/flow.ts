/**
 * Accès à l'instance React Flow hors des composants (zoom, viewport pour l'enregistrement).
 */
import type { ReactFlowInstance } from '@xyflow/react'
import type { CableFlowEdge } from '../components/canvas/CableEdge'
import type { DeviceFlowNode } from '../components/canvas/DeviceNode'

/** Sous-ensemble de l'instance React Flow utilisé hors du canvas. */
export type FlowApi = Pick<
  ReactFlowInstance<DeviceFlowNode, CableFlowEdge>,
  | 'getViewport'
  | 'setViewport'
  | 'fitView'
  | 'zoomIn'
  | 'zoomOut'
  | 'screenToFlowPosition'
  | 'flowToScreenPosition'
>

let instance: FlowApi | null = null

export function setFlowInstance(next: FlowApi | null): void {
  instance = next
}

export function getFlowInstance(): FlowApi | null {
  return instance
}

/** Dimensions d'un nœud équipement (doivent correspondre à DeviceNode). */
export const NODE_WIDTH = 88
export const ICON_SIZE = 56
/** Centre de l'icône relativement au coin supérieur gauche du nœud. */
export const ICON_CENTER = { x: NODE_WIDTH / 2, y: ICON_SIZE / 2 }
