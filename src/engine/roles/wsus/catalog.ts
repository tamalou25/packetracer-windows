/**
 * Catalogue fictif du service de mise à jour en amont : ce que le serveur WSUS récupère lors
 * d'une synchronisation. Numéros KB et titres inventés (série KB91xxxxx) : aucune vraie mise à jour.
 */
import type { WsusClassification } from './schema'

export interface CatalogUpdate {
  /** Identifiant de la mise à jour (numéro d'article KB). */
  id: string
  title: string
  classification: WsusClassification
  /** Produit concerné : système serveur, système client, ou les deux. */
  product: 'server' | 'client' | 'all'
}

export const CLASSIFICATION_LABELS: Record<WsusClassification, string> = {
  critical: 'Mises à jour critiques',
  security: 'Mises à jour de la sécurité',
  definition: 'Mises à jour de définitions',
  drivers: 'Pilotes',
  featurepacks: 'Feature Packs',
  servicepacks: 'Service Packs',
  tools: 'Outils',
  rollups: 'Correctifs cumulatifs',
  updates: 'Mises à jour',
  upgrades: 'Mises à niveau'
}

export const PRODUCT_LABELS: Record<CatalogUpdate['product'], string> = {
  server: 'Système d’exploitation serveur',
  client: 'Système d’exploitation client',
  all: 'Tous les systèmes'
}

export const UPDATE_CATALOG: CatalogUpdate[] = [
  {
    id: 'KB9100101',
    title: 'Mise à jour cumulative de sécurité pour le système serveur (KB9100101)',
    classification: 'security',
    product: 'server'
  },
  {
    id: 'KB9100102',
    title: 'Mise à jour cumulative de sécurité pour le système client (KB9100102)',
    classification: 'security',
    product: 'client'
  },
  {
    id: 'KB9100103',
    title: 'Mise à jour de sécurité du navigateur intégré (KB9100103)',
    classification: 'security',
    product: 'all'
  },
  {
    id: 'KB9100201',
    title: 'Mise à jour critique de la pile de maintenance (KB9100201)',
    classification: 'critical',
    product: 'all'
  },
  {
    id: 'KB9100202',
    title: 'Mise à jour critique du client de mise à jour (KB9100202)',
    classification: 'critical',
    product: 'client'
  },
  {
    id: 'KB9100301',
    title: 'Mise à jour des définitions de l’antivirus intégré (KB9100301)',
    classification: 'definition',
    product: 'all'
  },
  {
    id: 'KB9100401',
    title: 'Pilote de carte réseau Ethernet générique (KB9100401)',
    classification: 'drivers',
    product: 'all'
  },
  {
    id: 'KB9100501',
    title: 'Correctif cumulatif pour le système serveur (KB9100501)',
    classification: 'rollups',
    product: 'server'
  },
  {
    id: 'KB9100601',
    title: 'Mise à jour du .NET Framework (KB9100601)',
    classification: 'updates',
    product: 'all'
  },
  {
    id: 'KB9100701',
    title: 'Outil de suppression de logiciels malveillants (KB9100701)',
    classification: 'tools',
    product: 'all'
  },
  {
    id: 'KB9100801',
    title: 'Mise à niveau de fonctionnalités du système client, version 24H2 (KB9100801)',
    classification: 'upgrades',
    product: 'client'
  },
  {
    id: 'KB9100901',
    title: 'Feature Pack de compatibilité multimédia (KB9100901)',
    classification: 'featurepacks',
    product: 'client'
  }
]

export function catalogUpdate(id: string): CatalogUpdate | undefined {
  const upper = id.trim().toUpperCase()
  return UPDATE_CATALOG.find((u) => u.id === upper)
}

/** La mise à jour s'applique-t-elle à ce type d'ordinateur ? */
export function appliesTo(update: CatalogUpdate, kind: 'server' | 'client'): boolean {
  return update.product === 'all' || update.product === kind
}
