/**
 * Contrat d'une fonctionnalité IOS (sur le modèle des modules de rôles serveur) : chaque
 * fonctionnalité déclare ses commandes CLI ; le registre (registry.ts) les rassemble.
 */
import type { LabState, NetInterface } from '../model/schema'
import type { CliCommand } from './cli/types'
import type { IosDevice } from './device'
import type { ConfigBlock } from './running-config'

export interface IosFeature {
  /** Identifiant court (fichier `features/<id>.ts`). */
  id: string
  /** Commandes de la CLI (modes, syntaxe, gestionnaires). */
  commands: readonly CliCommand[]
  /** Blocs globaux de la running-config. */
  config?(device: IosDevice, state: LabState): ConfigBlock[]
  /** Lignes de la section `interface` d'une interface. */
  interfaceConfig?(device: IosDevice, iface: NetInterface, state: LabState): ConfigBlock[]
}

/** Déclare une fonctionnalité IOS. */
export function defineIosFeature(feature: IosFeature): IosFeature {
  return feature
}
