/**
 * Recherches communes aux évaluateurs de critères de lab (équipements par nom, comparaisons).
 */
import type { Device, Domain, HostDevice, LabState, ServerDevice } from '../model/schema'
import { effectiveIpv4 } from '../net/addressing'
import { isIpv4 } from '../net/ipv4'

export function byName(state: LabState, name: string): Device | undefined {
  const lower = name.toLowerCase()
  return Object.values(state.devices).find((d) => d.name.toLowerCase() === lower)
}

export function hostByName(state: LabState, name: string): HostDevice | undefined {
  const d = byName(state, name)
  return d && (d.kind === 'server' || d.kind === 'client') ? d : undefined
}

export function serverByName(state: LabState, name: string): ServerDevice | undefined {
  const d = byName(state, name)
  return d?.kind === 'server' ? d : undefined
}

/** Adresse IP d'une cible : adresse littérale ou première adresse d'un équipement. */
export function targetIp(state: LabState, target: string): string | null {
  if (isIpv4(target)) return target
  const device = byName(state, target)
  for (const iface of device?.interfaces ?? []) {
    const eff = effectiveIpv4(iface)
    if (eff) return eff.address
  }
  return null
}

export function firstDomain(state: LabState): Domain | undefined {
  return Object.values(state.domains)[0]
}

export const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
export const fqdn = (s: string): string => s.toLowerCase().replace(/\.$/, '')
