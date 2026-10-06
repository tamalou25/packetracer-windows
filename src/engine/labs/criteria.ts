/**
 * Critères de validation des labs : chaque type déclare son schéma (zod) et son évaluateur,
 * qui lit l'état du lab sans le modifier. Les évaluateurs utilisent les mêmes fonctions que
 * les consoles et l'interface (ping, résolution DNS, accès effectif…).
 *
 * Types du système de base ici ; les types propres à un rôle sont déclarés par son module
 * (`roles/<rôle>/criteria.ts`) et rassemblés par le registre.
 */
import { z } from 'zod'
import type { LabState } from '../model/schema'
import { effectiveIpv4 } from '../net/addressing'
import { ping } from '../net/diagnostics'
import { switchportOf } from '../net/switchport'
import { roleCriteria } from '../roles/registry'
import { defineCriterion, type CriterionType } from '../roles/types'
import { byName, hostByName, sameName, targetIp } from './lookup'

/** Critères du système de base (adressage, connectivité, rôles installés). */
const CORE_CRITERIA: CriterionType[] = [
  defineCriterion(
    z.object({
      type: z.literal('interfaceIp'),
      device: z.string(),
      /** Nom de la carte (Gi0/0, Ethernet0) ; par défaut la première carte de niveau 3. */
      interface: z.string().optional(),
      address: z.string(),
      prefixLength: z.number().int().optional(),
      gateway: z.string().optional()
    }),
    (state, check) => {
      const device = byName(state, check.device)
      const iface = check.interface
        ? device?.interfaces.find((i) => sameName(i.name, check.interface ?? ''))
        : device?.interfaces.find((i) => i.l3)
      const eff = iface ? effectiveIpv4(iface) : null
      return (
        !!eff &&
        eff.address === check.address &&
        (check.prefixLength === undefined || eff.prefixLength === check.prefixLength) &&
        (check.gateway === undefined || eff.gateway === check.gateway)
      )
    }
  ),
  defineCriterion(
    z.object({
      type: z.literal('ping'),
      from: z.string(),
      to: z.string(),
      /** false : le ping doit échouer (isolement d'un réseau, filtrage). */
      success: z.boolean().default(true)
    }),
    (state, check) => {
      const from = byName(state, check.from)
      const ip = targetIp(state, check.to)
      if (!from || !ip) return false
      const r = ping(state, from.id, ip, { count: 1 })
      return r.ok && r.value.success === (check.success !== false)
    }
  ),
  defineCriterion(
    z.object({
      type: z.literal('switchport'),
      device: z.string(),
      port: z.string(),
      mode: z.enum(['access', 'trunk']).optional(),
      /** VLAN d'accès (port d'accès) ou VLAN qui doit circuler sur le trunk. */
      vlan: z.number().int().optional()
    }),
    (state, check) => {
      const device = byName(state, check.device)
      const port =
        device?.kind === 'switch' ? device.interfaces.find((i) => sameName(i.name, check.port)) : undefined
      if (!device || device.kind !== 'switch' || !port) return false
      const config = switchportOf(port)
      if (check.mode !== undefined && config.mode !== check.mode) return false
      if (check.vlan === undefined) return true
      if (!device.vlans.some((v) => v.id === check.vlan)) return false
      return config.mode === 'access'
        ? config.accessVlan === check.vlan
        : config.allowedVlans === null || config.allowedVlans.includes(check.vlan)
    }
  ),
  defineCriterion(
    z.object({ type: z.literal('featureInstalled'), device: z.string(), feature: z.string() }),
    (state, check) => !!hostByName(state, check.device)?.host.features.includes(check.feature)
  )
]

let types: Map<string, CriterionType> | null = null

/** Types de critères disponibles (système de base + modules de rôles), par nom. */
export function criterionTypes(): Map<string, CriterionType> {
  return (types ??= new Map([...CORE_CRITERIA, ...roleCriteria()].map((c) => [c.type, c])))
}

/** Vérification d'un critère : `type` plus les paramètres propres à ce type. */
export type Check = { type: string } & Record<string, unknown>

/** Union discriminée de tous les types de vérification (construite à la première validation). */
export const CheckSchema: z.ZodType<Check> = z.lazy(
  () =>
    z.discriminatedUnion(
      'type',
      [...criterionTypes().values()].map((c) => c.schema) as [z.ZodObject, ...z.ZodObject[]]
    ) as unknown as z.ZodType<Check>
)

export const CriterionSchema = z.object({
  id: z.string(),
  /** Ce qui est attendu, formulé pour l'étudiant. */
  label: z.string(),
  /** Indice affiché en cas d'échec : oriente sans donner la solution. */
  hint: z.string(),
  check: CheckSchema
})

export type Criterion = z.infer<typeof CriterionSchema>

/** Évalue une vérification sur l'état du lab (type inconnu → non validé). */
export function evaluateCheck(state: LabState, check: Check): boolean {
  return criterionTypes().get(check.type)?.evaluate(state, check) ?? false
}

export interface CriterionResult {
  id: string
  ok: boolean
}

/** Évalue tous les critères d'un lab. */
export function evaluateCriteria(state: LabState, criteria: Criterion[]): CriterionResult[] {
  return criteria.map((c) => ({ id: c.id, ok: evaluateCheck(state, c.check) }))
}
