/**
 * Cmdlets du module NPS : clients RADIUS.
 */
import type { ServerDevice } from '../../model/schema'
import type { CmdContext } from '../../shell/ps/interpreter'
import type { CmdletDef } from '../../shell/ps/registry'
import { psObject, psToString } from '../../shell/ps/values'
import { hasFeature } from '../../shell/ps/cmdlets/helpers'
import { addRadiusClient, removeRadiusClient } from './actions'
import type { RadiusClient } from './schema'
import { npsOf } from './state'

const nps = (ctx: CmdContext) => hasFeature(ctx, 'NPAS')

const clientObject = (c: RadiusClient) =>
  psObject(
    'NpsRadiusClient',
    {
      Name: c.name,
      Address: c.address,
      AuthAttributeRequired: false,
      SharedSecret: c.sharedSecret,
      VendorName: 'RADIUS Standard',
      Enabled: true
    },
    {
      kind: 'list',
      props: ['Name', 'Address', 'AuthAttributeRequired', 'SharedSecret', 'VendorName', 'Enabled']
    }
  )

export const npsCmdlets: CmdletDef[] = [
  {
    name: 'New-NpsRadiusClient',
    module: 'NPS',
    synopsis: 'Déclare un client RADIUS (serveur d’accès) sur le serveur NPS.',
    available: nps,
    params: [
      { name: 'Name', type: 'string', mandatory: true },
      { name: 'Address', type: 'string', mandatory: true },
      { name: 'SharedSecret', type: 'string', mandatory: true }
    ],
    run(ctx, args) {
      const input = {
        name: psToString(args['Name']),
        address: psToString(args['Address']),
        sharedSecret: psToString(args['SharedSecret'])
      }
      ctx.apply(addRadiusClient(ctx.state, ctx.deviceId, input))
      const created = npsOf(ctx.host as ServerDevice)?.radiusClients.find((c) => c.name === input.name.trim())
      return created ? [clientObject(created)] : []
    }
  },
  {
    name: 'Get-NpsRadiusClient',
    module: 'NPS',
    synopsis: 'Affiche les clients RADIUS du serveur NPS.',
    available: nps,
    params: [],
    run(ctx) {
      return (npsOf(ctx.host as ServerDevice)?.radiusClients ?? []).map(clientObject)
    }
  },
  {
    name: 'Remove-NpsRadiusClient',
    module: 'NPS',
    synopsis: 'Supprime un client RADIUS du serveur NPS.',
    available: nps,
    params: [{ name: 'Name', type: 'string', mandatory: true }],
    run(ctx, args) {
      ctx.apply(removeRadiusClient(ctx.state, ctx.deviceId, psToString(args['Name'])))
    }
  }
]
