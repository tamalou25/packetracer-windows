/**
 * Apparence des équipements (icônes lucide, couleurs) — purement visuel.
 */
import { Cloud, Monitor, Network, Router, Server, type LucideIcon } from 'lucide-react'
import type { DeviceKind } from '@engine/index'

export const DEVICE_ICONS: Record<DeviceKind, LucideIcon> = {
  server: Server,
  client: Monitor,
  switch: Network,
  router: Router,
  cloud: Cloud
}

/** Liseré de catégorie des nœuds du canvas. */
export const KIND_STRIPE: Record<DeviceKind, string> = {
  server: 'bg-kind-server',
  client: 'bg-kind-client',
  switch: 'bg-kind-switch',
  router: 'bg-kind-router',
  cloud: 'bg-kind-cloud'
}

/** Classes de la pastille de chaque type d'équipement (tokens de catégorie, voir styles.css). */
export const DEVICE_COLORS: Record<DeviceKind, string> = {
  server: 'bg-kind-server text-white',
  client: 'bg-kind-client text-white',
  switch: 'bg-kind-switch text-white',
  router: 'bg-kind-router text-white',
  cloud: 'bg-kind-cloud text-white'
}
