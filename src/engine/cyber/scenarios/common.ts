/**
 * Lectures communes aux scénarios « annuaire » : recherche du compte visé, du contrôleur de
 * domaine et des faiblesses de configuration. Aucune écriture, aucun calcul offensif.
 */
import type { AdUser, Domain, HostDevice, LabState } from '../../model/schema'
import { passwordMeetsPolicy } from '../../roles/adds/directory'
import { fsmoHolder } from '../../roles/adds/fsmo'
import { domainPasswordPolicy } from '../../roles/gpo/scope'

export const DAY_MS = 86_400_000

export interface DomainAccount {
  domain: Domain
  user: AdUser
}

/** Compte « DOMAINE\\sam » tel qu'il apparaît dans les journaux. */
export const qualified = ({ domain, user }: DomainAccount): string => `${domain.netbios}\\${user.sam}`

/** Tous les comptes de tous les domaines du lab. */
export function allAccounts(state: LabState): DomainAccount[] {
  return Object.values(state.domains).flatMap((domain) => domain.users.map((user) => ({ domain, user })))
}

/** Contrôleur qui journalise les événements d'authentification du domaine. */
export const controllerOf = (domain: Domain): string | null => domain.controllers[0] ?? null

/** Émulateur PDC, où les verrouillages (4740) sont inscrits. */
export const pdcOf = (domain: Domain): string | null => fsmoHolder(domain, 'PDCEmulator')

/**
 * Mot de passe faible au sens de la stratégie du domaine (longueur, complexité, nom du compte).
 * Jamais de comparaison à une liste de mots de passe : voir `docs/fidelite.md`.
 */
export const hasWeakPassword = ({ domain, user }: DomainAccount): boolean =>
  !passwordMeetsPolicy(user.password, user.sam, domainPasswordPolicy(domain))

/** Ordinateur (serveur ou poste) de l'état simulé. */
export const hostOf = (state: LabState, id: string): HostDevice | null => {
  const device = state.devices[id]
  return device && (device.kind === 'server' || device.kind === 'client') ? device : null
}
