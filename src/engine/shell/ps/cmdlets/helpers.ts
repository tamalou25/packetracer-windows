/**
 * Utilitaires communs aux cmdlets.
 */
import type { NetInterface } from '../../../model/schema'
import { psError } from '../errors'
import type { CmdContext } from '../interpreter'
import type { BoundArgs } from '../registry'
import { psToString } from '../values'

/** La commande ne fonctionne que sur un serveur (module serveur). */
export function onServer(ctx: CmdContext): boolean {
  return ctx.device.kind === 'server'
}

/** Rôle/fonctionnalité installé sur l'ordinateur courant. */
export function hasFeature(ctx: CmdContext, name: string): boolean {
  const d = ctx.device
  return (d.kind === 'server' || d.kind === 'client') && d.host.features.includes(name)
}

/** Index d'interface (comme ifIndex) : stable selon l'ordre des cartes. */
export function ifIndexOf(ctx: CmdContext, iface: NetInterface): number {
  return 4 + ctx.host.interfaces.findIndex((i) => i.id === iface.id) * 2
}

/** Carte désignée par -InterfaceAlias ou -InterfaceIndex. */
export function findInterface(ctx: CmdContext, args: BoundArgs, required = true): NetInterface | null {
  const alias = args['InterfaceAlias']
  const index = args['InterfaceIndex']
  const ifaces = ctx.host.interfaces.filter((i) => i.l3)
  if (alias !== undefined) {
    const name = psToString(alias)
    const found = ifaces.find((i) => i.name.toLowerCase() === name.toLowerCase())
    if (!found)
      throw psError(
        `Aucun objet NetIPInterface trouvé avec la propriété « InterfaceAlias » égale à « ${name} ». Vérifiez la valeur de la propriété et réessayez.`,
        'ObjectNotFound',
        'CmdletizationQuery_NotFound_InterfaceAlias',
        name
      )
    return found
  }
  if (index !== undefined) {
    const found = ifaces.find((i) => ifIndexOf(ctx, i) === Number(index))
    if (!found)
      throw psError(
        `Aucun objet NetIPInterface trouvé avec la propriété « InterfaceIndex » égale à « ${psToString(index)} ».`,
        'ObjectNotFound',
        'CmdletizationQuery_NotFound_InterfaceIndex',
        psToString(index)
      )
    return found
  }
  if (required)
    throw psError(
      'Spécifiez la carte avec -InterfaceAlias ou -InterfaceIndex.',
      'InvalidArgument',
      'InterfaceRequired'
    )
  return null
}

/** Noms des cartes réseau (complétion). */
export function interfaceNames(ctx: CmdContext): string[] {
  const d = ctx.state.devices[ctx.session.deviceId]
  return d ? d.interfaces.filter((i) => i.l3).map((i) => i.name) : []
}
