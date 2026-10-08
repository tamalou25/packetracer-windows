/**
 * Contrat d'une fonctionnalité IOS (sur le modèle des modules de rôles serveur) : chaque
 * fonctionnalité déclare ses commandes CLI ; le registre (registry.ts) les rassemble.
 */
import type { CliCommand } from './cli/types'

export interface IosFeature {
  /** Identifiant court (fichier `features/<id>.ts`). */
  id: string
  /** Commandes de la CLI (modes, syntaxe, gestionnaires). */
  commands: readonly CliCommand[]
}

/** Déclare une fonctionnalité IOS. */
export function defineIosFeature(feature: IosFeature): IosFeature {
  return feature
}
