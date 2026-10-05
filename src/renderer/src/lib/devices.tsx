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

/** Classes Tailwind de la pastille de chaque type d'équipement. */
export const DEVICE_COLORS: Record<DeviceKind, string> = {
  server: 'bg-indigo-600 text-white',
  client: 'bg-sky-600 text-white',
  switch: 'bg-emerald-600 text-white',
  router: 'bg-amber-600 text-white',
  cloud: 'bg-slate-500 text-white'
}
