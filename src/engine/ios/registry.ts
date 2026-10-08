/**
 * Registre des fonctionnalités IOS (navigation, configuration de base, VLAN, routage…) : les
 * arbres de commandes des modes en sont dérivés (cli/tree.ts).
 */
import type { CliCommand } from './cli/types'
import type { Device, LabState, NetInterface } from '../model/schema'
import { ifaceStatus } from './status'
import type { Route } from '../net/routing'
import type { TransitHooks } from '../sim/transit'
import { isIos } from './device'
import type { IosFeature } from './feature'
import { base } from './features/base'
import { navigation } from './features/navigation'
import { routing } from './features/routing'
import { vlan } from './features/vlan'

/** Fonctionnalités, dans l'ordre d'enregistrement. */
export function iosFeatures(): readonly IosFeature[] {
  return [navigation, base, vlan, routing]
}

/** Crochets d'acheminement des fonctionnalités (routage d'un switch, NAT, ACL…). */
export function iosTransitHooks(): TransitHooks[] {
  return iosFeatures().flatMap((f) => (f.transit ? [f.transit] : []))
}

/** Routes dynamiques d'un équipement IOS (aucune pour les autres équipements). */
export function iosDynamicRoutes(state: LabState, device: Device): Route[] {
  if (!isIos(device)) return []
  return iosFeatures().flatMap((f) => f.routes?.(state, device) ?? [])
}

/** Une interface d'équipement IOS ne porte une route connectée que si elle est up/up. */
export function iosInterfaceRoutes(state: LabState, device: Device, iface: NetInterface): boolean {
  return !isIos(device) || ifaceStatus(state, device, iface).protocol === 'up'
}

/** Toutes les commandes déclarées. */
export function iosCommands(): CliCommand[] {
  return iosFeatures().flatMap((f) => f.commands)
}
