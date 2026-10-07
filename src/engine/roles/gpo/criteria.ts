/**
 * Critères de lab du rôle Stratégies de groupe.
 */
import { z } from 'zod'
import { firstDomain, fqdn, hostByName, sameName } from '../../labs/lookup'
import { defineCriterion } from '../types'
import { findGpo, linksAt } from './scope'
import { settingValue, type SettingKey } from './settings'

export const gpoCriteria = [
  defineCriterion(
    z.object({
      type: z.literal('gpoLinked'),
      gpo: z.string(),
      /** Nom de l'OU, ou nom DNS du domaine pour la racine. */
      target: z.string(),
      enforced: z.boolean().optional()
    }),
    (state, check) => {
      const domain = firstDomain(state)
      const gpo = domain ? findGpo(domain, check.gpo) : undefined
      if (!domain || !gpo) return false
      const targetId =
        fqdn(check.target) === domain.name
          ? null
          : (domain.containers.find((c) => c.kind === 'ou' && sameName(c.name, check.target))?.id ??
            undefined)
      if (targetId === undefined) return false
      const link = linksAt(domain, targetId).find((l) => l.gpoId === gpo.id)
      return !!link && link.enabled && (check.enforced === undefined || link.enforced === check.enforced)
    },
    'GPO liée'
  ),
  defineCriterion(
    z.object({ type: z.literal('gpoSetting'), gpo: z.string(), setting: z.string(), value: z.string() }),
    (state, check) => {
      const domain = firstDomain(state)
      const gpo = domain ? findGpo(domain, check.gpo) : undefined
      if (!gpo) return false
      const value = settingValue(check.setting as SettingKey, gpo.computer, gpo.user)
      return value !== null && value.toLowerCase().startsWith(check.value.toLowerCase())
    },
    'Paramètre d’une GPO'
  ),
  defineCriterion(
    z.object({
      type: z.literal('gpoApplied'),
      device: z.string(),
      gpo: z.string(),
      part: z.enum(['computer', 'user']),
      account: z.string().optional()
    }),
    (state, check) => {
      const host = hostByName(state, check.device)
      const result = host?.host.policy[check.part]
      if (!result || !result.applied.some((a) => sameName(a.name, check.gpo))) return false
      return (
        check.account === undefined ||
        (check.part === 'user' && sameName(host?.host.policy.user?.account ?? '', check.account))
      )
    },
    'GPO appliquée à un ordinateur'
  )
]
