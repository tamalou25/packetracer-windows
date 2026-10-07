/**
 * Apparence des équipements (icônes lucide, couleurs) — purement visuel.
 */
import { Cloud, Monitor, Network, Router, Server, SquareTerminal, type LucideIcon } from 'lucide-react'
import { DEVICE_KIND_INFO, type Device, type DeviceKind } from '@engine/index'

/** Entrée de la palette : un type d'équipement, ou le poste Linux (poste client Ubuntu simulé). */
export type PaletteKind = DeviceKind | 'linux'

/** Poste Linux : poste client dont le système est Ubuntu (simulé). */
export const isLinux = (device: Device): boolean => device.kind === 'client' && device.host.os === 'linux'

/** Paramètres de création d'un équipement de la palette. */
export function paletteParams(kind: PaletteKind): { kind: DeviceKind; os?: 'linux' } {
  return kind === 'linux' ? { kind: 'client', os: 'linux' } : { kind }
}

export const LINUX_INFO = {
  label: 'Poste Linux',
  description: 'Poste Ubuntu avec console bash (ip, dig, realm, mount cifs)',
  model: 'Ubuntu 22.04 (simulé) · 1 carte'
}

/** Libellé d'une entrée de la palette ou d'un équipement. */
export const paletteLabel = (kind: PaletteKind): string =>
  kind === 'linux' ? LINUX_INFO.label : DEVICE_KIND_INFO[kind].label
export const deviceLabel = (device: Device): string =>
  isLinux(device) ? LINUX_INFO.label : DEVICE_KIND_INFO[device.kind].label

export const DEVICE_ICONS: Record<PaletteKind, LucideIcon> = {
  server: Server,
  client: Monitor,
  linux: SquareTerminal,
  switch: Network,
  router: Router,
  cloud: Cloud
}

/** Icône d'un équipement (poste Linux distingué). */
export const deviceIcon = (device: Device): LucideIcon =>
  DEVICE_ICONS[isLinux(device) ? 'linux' : device.kind]

/** Liseré de catégorie des nœuds du canvas. */
export const KIND_STRIPE: Record<PaletteKind, string> = {
  server: 'bg-kind-server',
  client: 'bg-kind-client',
  linux: 'bg-kind-client',
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
