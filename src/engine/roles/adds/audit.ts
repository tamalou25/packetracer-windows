/**
 * Règles d'audit du rôle AD DS : Admins du domaine, mots de passe sans expiration, comptes inactifs.
 */
import type { Domain, LabState } from '../../model/schema'
import { INACTIVE_DAYS, MAX_DOMAIN_ADMINS, type AuditRule } from '../../audit/types'
import { AD_GROUPS, groupsOf } from './directory'

const DAY_MS = 86_400_000
const domains = (state: LabState): Domain[] => Object.values(state.domains)
const account = (domain: Domain, sam: string) => `${domain.netbios}\\${sam}`

export const addsAuditRules: AuditRule[] = [
  {
    id: 'domainAdmins',
    title: 'Trop de membres dans Admins du domaine',
    severity: 'élevée',
    fix: 'Retirez les comptes inutiles du groupe (Remove-ADGroupMember « Admins du domaine ») et déléguez des droits ciblés.',
    check: (state) =>
      domains(state).flatMap((d) => {
        const group = d.groups.find((g) => g.name === AD_GROUPS.domainAdmins)
        if (!group) return []
        const members = d.users.filter((u) => u.enabled && groupsOf(d, u.id).some((g) => g.id === group.id))
        return members.length > MAX_DOMAIN_ADMINS
          ? [
              {
                object: `${d.netbios}\\${AD_GROUPS.domainAdmins}`,
                detail: `${members.length} comptes activés (au plus ${MAX_DOMAIN_ADMINS} attendus) : ${members.map((u) => u.sam).join(', ')}.`
              }
            ]
          : []
      })
  },
  {
    id: 'passwordNeverExpires',
    title: 'Mots de passe sans expiration',
    severity: 'moyenne',
    fix: 'Décochez « Le mot de passe n’expire jamais » (Set-ADUser -PasswordNeverExpires $false).',
    check: (state) =>
      domains(state).flatMap((d) =>
        d.users
          .filter((u) => u.enabled && u.passwordNeverExpires)
          .map((u) => ({
            object: account(d, u.sam),
            detail: 'Le mot de passe de ce compte n’expire jamais.'
          }))
      )
  },
  {
    id: 'inactiveAccounts',
    title: 'Comptes inactifs',
    severity: 'moyenne',
    fix: `Désactivez (Disable-ADAccount) ou supprimez les comptes inutilisés depuis plus de ${INACTIVE_DAYS} jours.`,
    check: (state) =>
      domains(state).flatMap((d) =>
        d.users
          .filter(
            (u) =>
              u.enabled && !u.builtin && (u.lastLogon ?? u.whenCreated) < state.clock - INACTIVE_DAYS * DAY_MS
          )
          .map((u) => {
            const days = Math.floor((state.clock - (u.lastLogon ?? u.whenCreated)) / DAY_MS)
            return {
              object: account(d, u.sam),
              detail:
                u.lastLogon === null
                  ? `Compte activé, jamais utilisé depuis sa création il y a ${days} jours.`
                  : `Aucune ouverture de session depuis ${days} jours.`
            }
          })
      )
  }
]
