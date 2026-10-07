/**
 * Verrouillage des comptes du domaine : un compte reste verrouillé tant que la durée de la
 * stratégie n'est pas écoulée (durée 0 : jusqu'au déverrouillage par un administrateur).
 */
import type { AdUser, Domain } from '../../model/schema'
import { domainLockoutPolicy } from '../gpo/scope'

type LockState = Pick<AdUser, 'lockoutTime'>

/** Le verrouillage enregistré est-il arrivé à expiration à l'heure `clock` ? */
export function lockoutExpired(domain: Domain, user: LockState, clock: number): boolean {
  const { duration } = domainLockoutPolicy(domain)
  return user.lockoutTime !== null && duration > 0 && clock >= user.lockoutTime + duration * 60_000
}

/** Le compte est-il verrouillé à l'heure `clock` ? */
export function isLockedOut(domain: Domain, user: LockState, clock: number): boolean {
  return user.lockoutTime !== null && !lockoutExpired(domain, user, clock)
}
