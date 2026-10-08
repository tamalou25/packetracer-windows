/**
 * Scénarios fournis, un fichier chacun. Ajouter un scénario = créer son fichier puis le lister ici.
 */
import type { AttackScenario } from '../scenario'
import { authRepetee } from './auth-repetee'
import { compteService } from './compte-service'
import { reutilisationAcces } from './reutilisation-acces'
import { sautDeVlan } from './saut-de-vlan'
import { usurpationArp } from './usurpation-arp'

export const SCENARIOS: AttackScenario[] = [
  authRepetee,
  compteService,
  reutilisationAcces,
  usurpationArp,
  sautDeVlan
]
