/**
 * Registre des fonctionnalités IOS (navigation, configuration de base, VLAN, routage…) : les
 * arbres de commandes des modes en sont dérivés (cli/tree.ts).
 */
import type { CliCommand } from './cli/types'
import type { TransitHooks } from '../sim/transit'
import type { IosFeature } from './feature'
import { base } from './features/base'
import { navigation } from './features/navigation'
import { vlan } from './features/vlan'

/** Fonctionnalités, dans l'ordre d'enregistrement. */
export function iosFeatures(): readonly IosFeature[] {
  return [navigation, base, vlan]
}

/** Crochets d'acheminement des fonctionnalités (routage d'un switch, NAT, ACL…). */
export function iosTransitHooks(): TransitHooks[] {
  return iosFeatures().flatMap((f) => (f.transit ? [f.transit] : []))
}

/** Toutes les commandes déclarées. */
export function iosCommands(): CliCommand[] {
  return iosFeatures().flatMap((f) => f.commands)
}
