/**
 * Contrat d'une fonctionnalité IOS (sur le modèle des modules de rôles serveur) : chaque
 * fonctionnalité déclare ses commandes CLI ; le registre (registry.ts) les rassemble.
 */
import type { LabState, NetInterface } from '../model/schema'
import type { Route } from '../net/routing'
import type { Draft } from 'immer'
import type { TraceEffect } from '../sim/trace'
import type { TransitHooks } from '../sim/transit'
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
  /** Acheminement des paquets (routage d'un switch de niveau 3, NAT, ACL…). */
  transit?: TransitHooks
  /** Effet durable d'un échange de paquets (traduction NAT, compteur d'ACL) sur l'équipement. */
  onEffect?(device: Draft<IosDevice>, effect: TraceEffect): void
  /**
   * Stabilisation après toute modification du lab (élection HSRP…) : exécutée après chaque
   * commande IOS et par les tâches de fond. Renvoie l'état inchangé s'il n'y a rien à faire.
   */
  settle?(state: LabState): LabState
  /** Messages de la console d'un équipement après stabilisation (%HSRP-6-STATECHANGE…). */
  settleMessages?(before: LabState, after: LabState, deviceId: string): string[]
  /** Routes apprises dynamiquement (OSPF), ajoutées à la table de routage du moteur. */
  routes?(state: LabState, device: IosDevice): Route[]
}

/** Déclare une fonctionnalité IOS. */
export function defineIosFeature(feature: IosFeature): IosFeature {
  return feature
}
