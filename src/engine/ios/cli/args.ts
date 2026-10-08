/**
 * Types d'arguments de la CLI IOS (reconnaissance, aide, complétion).
 */
import { parseIpv4 } from '../../net/ipv4'
import type { ArgContext, ArgType } from './types'

const single = (test: (token: string) => boolean): ArgType['match'] => {
  return (tokens, index) => {
    const token = tokens[index]
    return token !== undefined && test(token) ? { consumed: 1, value: token } : null
  }
}

/** Mot quelconque (nom, mot de passe…). */
export const WORD: ArgType = { label: 'WORD', match: single(() => true) }

/** Texte libre jusqu'à la fin de la ligne (bannière, description). */
export const LINE: ArgType = {
  label: 'LINE',
  rest: true,
  match: (tokens, index) =>
    index < tokens.length ? { consumed: tokens.length - index, value: tokens.slice(index).join(' ') } : null
}

/** Entier borné : <1-4094>. */
export function number(min: number, max: number): ArgType {
  return {
    label: `<${min}-${max}>`,
    match: single((t) => /^\d+$/.test(t) && Number(t) >= min && Number(t) <= max)
  }
}

/** Adresse IPv4 (A.B.C.D). */
export const IPV4: ArgType = { label: 'A.B.C.D', match: single((t) => parseIpv4(t) !== null) }

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface IfaceTypeInfo {
  long: string
  short: string
  help: string
}

const IFACE_TYPES: IfaceTypeInfo[] = [
  { long: 'FastEthernet', short: 'Fa', help: 'FastEthernet IEEE 802.3' },
  { long: 'GigabitEthernet', short: 'Gi', help: 'GigabitEthernet IEEE 802.3z' },
  { long: 'Vlan', short: 'Vl', help: 'Catalyst Vlans' }
]

export interface IfaceArgOptions {
  /** Sous-interfaces acceptées (Gi0/0.10). */
  subinterfaces?: boolean
  /** Interfaces VLAN acceptées (interface vlan 10). */
  vlans?: boolean
}

/** Types d'interface présents sur l'équipement (Vlan : switchs). */
function deviceIfaceTypes(ctx: ArgContext, options: IfaceArgOptions): IfaceTypeInfo[] {
  const device = ctx.state.devices[ctx.deviceId]
  if (!device) return []
  const prefixes = new Set(device.interfaces.map((i) => i.name.replace(/[\d/.]+$/, '')))
  return IFACE_TYPES.filter(
    (t) => prefixes.has(t.short) || (t.short === 'Vl' && !!options.vlans && device.kind === 'switch')
  )
}

/** Type d'interface désigné par un préfixe (g, gi, Gigabit…), null si inconnu ou ambigu. */
function resolveIfaceType(prefix: string, ctx: ArgContext, options: IfaceArgOptions): IfaceTypeInfo | null {
  const lower = prefix.toLowerCase()
  const found = deviceIfaceTypes(ctx, options).filter((t) => t.long.toLowerCase().startsWith(lower))
  return found.length === 1 ? (found[0] ?? null) : null
}

/**
 * Interface désignée comme sur IOS : `g0/0`, `gi 0/0`, `GigabitEthernet0/0.10`, `vlan 10`.
 * Valeur : nom court du moteur (Gi0/0, Gi0/0.10, Vl10). Le port physique doit exister.
 */
export function iface(options: IfaceArgOptions = {}): ArgType {
  return {
    label: 'interface',
    match: (tokens, index, ctx) => {
      const first = tokens[index]
      if (first === undefined) return null
      const joined = /^([A-Za-z]+)(\d.*)$/.exec(first)
      let prefix: string
      let num: string
      let consumed: number
      if (joined) {
        prefix = joined[1] as string
        num = joined[2] as string
        consumed = 1
      } else {
        const next = tokens[index + 1]
        if (!/^[A-Za-z]+$/.test(first) || next === undefined || !/^\d/.test(next)) return null
        prefix = first
        num = next
        consumed = 2
      }
      const type = resolveIfaceType(prefix, ctx, options)
      if (!type) return null
      if (type.short === 'Vl') {
        if (!options.vlans || !/^\d+$/.test(num) || Number(num) < 1 || Number(num) > 4094) return null
        return { consumed, value: `Vl${Number(num)}` }
      }
      const m = /^(\d+(?:\/\d+)+)(?:\.(\d+))?$/.exec(num)
      if (!m) return null
      const physical = `${type.short}${m[1]}`
      const device = ctx.state.devices[ctx.deviceId]
      if (!device?.interfaces.some((i) => i.name === physical && !i.subinterface)) return null
      if (m[2] === undefined) return { consumed, value: physical }
      if (!options.subinterfaces || device.kind !== 'router' || Number(m[2]) < 1) return null
      return { consumed, value: `${physical}.${Number(m[2])}` }
    },
    helpEntries: (ctx) => deviceIfaceTypes(ctx, options).map((t) => ({ word: t.long, help: t.help })),
    complete: (partial, ctx) =>
      deviceIfaceTypes(ctx, options)
        .map((t) => t.long)
        .filter((w) => w.toLowerCase().startsWith(partial.toLowerCase()))
  }
}
