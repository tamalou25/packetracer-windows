/**
 * Cmdlets RemoteAccess (serveur) et VpnClient (client), outil rasdial.
 */
import type { ServerDevice } from '../../model/schema'
import { effectiveIpv4 } from '../../net/addressing'
import { CommandFailure } from '../../shell/context'
import { psError } from '../../shell/ps/errors'
import type { CmdContext } from '../../shell/ps/interpreter'
import type { CmdletDef } from '../../shell/ps/registry'
import { flatten, psObject, psToString, type PsValue } from '../../shell/ps/values'
import { hasFeature } from '../../shell/ps/cmdlets/helpers'
import type { ToolDef } from '../../shell/tools/types'
import { addRadiusServer, configureRras, disableRras, removeRadiusServer, setVpnPool } from './actions'
import { natEnabled, rrasOf, vpnEnabled } from './state'
import { addVpnConnection, removeVpnConnection, vpnConnect, vpnDisconnect } from './vpn'

const remoteAccess = (ctx: CmdContext) => hasFeature(ctx, 'RemoteAccess')

function range(value: PsValue | undefined): { start: string; end: string } {
  const parts = flatten(value === undefined ? [] : [value])
    .flatMap((v) => psToString(v).split(/[,-]/))
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length !== 2)
    throw psError(
      'Indiquez la plage d’adresses sous la forme -IPAddressRange <début>,<fin>.',
      'InvalidArgument',
      'InvalidIPAddressRange'
    )
  return { start: parts[0] ?? '', end: parts[1] ?? '' }
}

/** Seuls les serveurs RADIUS d'authentification VPN sont simulés. */
function purposeAuthentication(value: PsValue | undefined) {
  if (value !== undefined && psToString(value) !== 'Authentication')
    throw psError(
      'Seuls les serveurs RADIUS d’authentification (-Purpose Authentication) sont simulés.',
      'NotImplemented',
      'NotSupported'
    )
}

/** Adresse privée (RFC 1918). */
const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)

/**
 * Interface connectée à Internet : adresse publique en priorité, sinon carte portant une
 * passerelle par défaut.
 */
function internetInterface(ctx: CmdContext): string | null {
  const addressed = ctx.host.interfaces.filter((i) => effectiveIpv4(i))
  const pub = addressed.find((i) => !isPrivate(effectiveIpv4(i)?.address ?? ''))
  return (pub ?? addressed.find((i) => !!effectiveIpv4(i)?.gateway))?.id ?? null
}

export const rrasCmdlets: CmdletDef[] = [
  {
    name: 'Install-RemoteAccess',
    module: 'RemoteAccess',
    synopsis: 'Configure le serveur d’accès à distance (VPN ou routage).',
    available: remoteAccess,
    params: [
      { name: 'VpnType', type: 'string', validateSet: ['Vpn', 'RoutingOnly', 'VpnS2S'] },
      { name: 'IPAddressRange', type: 'string[]' }
    ],
    run(ctx, args) {
      const type = args['VpnType'] ? psToString(args['VpnType']) : 'Vpn'
      if (type === 'VpnS2S')
        throw psError(
          'Le VPN de site à site n’est pas simulé : utilisez -VpnType Vpn ou RoutingOnly.',
          'NotImplemented',
          'NotSupported'
        )
      ctx.apply(
        configureRras(
          ctx.state,
          ctx.deviceId,
          type === 'RoutingOnly'
            ? { mode: 'routing' }
            : { mode: 'vpn', publicIfaceId: internetInterface(ctx), pool: range(args['IPAddressRange']) }
        )
      )
    }
  },
  {
    name: 'Uninstall-RemoteAccess',
    module: 'RemoteAccess',
    synopsis: 'Désactive le routage et l’accès distant.',
    available: remoteAccess,
    params: [],
    run(ctx) {
      if (!ctx.confirm('Accès à distance', 'Uninstall-RemoteAccess')) return
      ctx.apply(disableRras(ctx.state, ctx.deviceId))
    }
  },
  {
    name: 'Get-RemoteAccess',
    module: 'RemoteAccess',
    synopsis: 'Affiche la configuration de l’accès à distance.',
    available: remoteAccess,
    params: [],
    run(ctx) {
      const rras = rrasOf(ctx.host as ServerDevice)
      const installed = (on: boolean) => (on ? 'Installed' : 'Uninstalled')
      return [
        psObject(
          'Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/RemoteAccess/Server/RemoteAccess',
          {
            VpnStatus: installed(vpnEnabled(rras)),
            RoutingStatus: installed(!!rras?.mode),
            NatStatus: installed(natEnabled(rras)),
            IPAssignmentMethod: rras?.pool ? 'StaticPool' : 'Dhcp',
            IPAddressRangeList: rras?.pool ? `{${rras.pool.start} - ${rras.pool.end}}` : ''
          },
          {
            kind: 'list',
            props: ['VpnStatus', 'RoutingStatus', 'NatStatus', 'IPAssignmentMethod', 'IPAddressRangeList']
          }
        )
      ]
    }
  },
  {
    name: 'Set-VpnIPAddressAssignment',
    module: 'RemoteAccess',
    synopsis: 'Définit le pool d’adresses statiques des clients VPN.',
    available: remoteAccess,
    params: [
      { name: 'IPAssignmentMethod', type: 'string', validateSet: ['StaticPool', 'Dhcp'] },
      { name: 'IPAddressRange', type: 'string[]' }
    ],
    run(ctx, args) {
      if (args['IPAssignmentMethod'] === 'Dhcp')
        throw psError(
          'L’attribution par DHCP n’est pas simulée : utilisez un pool statique (StaticPool).',
          'NotImplemented',
          'NotSupported'
        )
      ctx.apply(setVpnPool(ctx.state, ctx.deviceId, range(args['IPAddressRange'])))
    }
  },
  {
    name: 'Add-RemoteAccessRadius',
    module: 'RemoteAccess',
    synopsis: 'Ajoute un serveur RADIUS d’authentification des clients VPN.',
    available: remoteAccess,
    params: [
      { name: 'ServerName', type: 'string', mandatory: true },
      { name: 'SharedSecret', type: 'string', mandatory: true },
      {
        name: 'Purpose',
        type: 'string',
        mandatory: true,
        validateSet: ['Authentication', 'Accounting', 'Otp']
      }
    ],
    run(ctx, args) {
      purposeAuthentication(args['Purpose'])
      ctx.apply(
        addRadiusServer(ctx.state, ctx.deviceId, {
          server: psToString(args['ServerName']),
          sharedSecret: psToString(args['SharedSecret'])
        })
      )
    }
  },
  {
    name: 'Get-RemoteAccessRadius',
    module: 'RemoteAccess',
    synopsis: 'Affiche les serveurs RADIUS d’authentification.',
    available: remoteAccess,
    params: [],
    run(ctx) {
      return (rrasOf(ctx.host as ServerDevice)?.radius ?? []).map((r) =>
        psObject(
          'Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/RemoteAccess/Server/RemoteAccessRadius',
          { ServerName: r.server, Port: 1812, Purpose: 'Authentication' },
          { kind: 'table', props: ['ServerName', 'Port', 'Purpose'] }
        )
      )
    }
  },
  {
    name: 'Remove-RemoteAccessRadius',
    module: 'RemoteAccess',
    synopsis: 'Retire un serveur RADIUS d’authentification.',
    available: remoteAccess,
    params: [
      { name: 'ServerName', type: 'string', mandatory: true },
      {
        name: 'Purpose',
        type: 'string',
        mandatory: true,
        validateSet: ['Authentication', 'Accounting', 'Otp']
      }
    ],
    run(ctx, args) {
      purposeAuthentication(args['Purpose'])
      ctx.apply(removeRadiusServer(ctx.state, ctx.deviceId, psToString(args['ServerName'])))
    }
  },
  {
    name: 'Get-RemoteAccessConnectionStatistics',
    module: 'RemoteAccess',
    synopsis: 'Affiche les clients VPN connectés.',
    available: remoteAccess,
    params: [],
    run(ctx) {
      const rras = rrasOf(ctx.host as ServerDevice)
      return (rras?.sessions ?? []).map((s) =>
        psObject(
          'RemoteAccessConnection',
          {
            UserName: s.user,
            ClientIPv4Address: s.address,
            ClientExternalAddress: s.clientAddress,
            ConnectionType: 'Vpn',
            TunnelType: 'Sstp'
          },
          { kind: 'table', props: ['UserName', 'ClientIPv4Address', 'ClientExternalAddress', 'TunnelType'] }
        )
      )
    }
  },
  {
    name: 'Add-VpnConnection',
    module: 'VpnClient',
    synopsis: 'Ajoute une connexion VPN.',
    params: [
      { name: 'Name', type: 'string', mandatory: true, position: 0 },
      { name: 'ServerAddress', type: 'string', mandatory: true, position: 1 },
      { name: 'TunnelType', type: 'string', validateSet: ['Sstp', 'Automatic', 'Ikev2', 'L2tp', 'Pptp'] },
      { name: 'Force', type: 'switch' }
    ],
    run(ctx, args) {
      ctx.apply(
        addVpnConnection(ctx.state, ctx.deviceId, {
          name: psToString(args['Name']),
          server: psToString(args['ServerAddress'])
        })
      )
    }
  },
  {
    name: 'Get-VpnConnection',
    module: 'VpnClient',
    synopsis: 'Affiche les connexions VPN.',
    params: [{ name: 'Name', type: 'string', position: 0 }],
    run(ctx, args) {
      const wanted = args['Name'] ? psToString(args['Name']).toLowerCase() : null
      const list = ctx.host.host.vpnConnections.filter((c) => !wanted || c.name.toLowerCase() === wanted)
      if (wanted && list.length === 0)
        throw psError(
          `La connexion VPN « ${psToString(args['Name'])} » est introuvable.`,
          'ObjectNotFound',
          'VPN 0x80070490,Get-VpnConnection'
        )
      return list.map((c) =>
        psObject(
          'Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/RemoteAccess/Client/VpnConnection',
          {
            Name: c.name,
            ServerAddress: c.server,
            TunnelType: 'Sstp',
            ConnectionStatus: c.connected ? 'Connected' : 'Disconnected',
            IPv4Address: c.connected?.address ?? ''
          },
          { kind: 'list', props: ['Name', 'ServerAddress', 'TunnelType', 'ConnectionStatus', 'IPv4Address'] }
        )
      )
    }
  },
  {
    name: 'Remove-VpnConnection',
    module: 'VpnClient',
    synopsis: 'Supprime une connexion VPN.',
    params: [
      { name: 'Name', type: 'string', mandatory: true, position: 0 },
      { name: 'Force', type: 'switch' }
    ],
    run(ctx, args) {
      const name = psToString(args['Name'])
      if (!ctx.confirm(name, 'Remove-VpnConnection')) return
      ctx.apply(removeVpnConnection(ctx.state, ctx.deviceId, name))
    }
  }
]

/** rasdial : établit, liste ou ferme les connexions VPN. */
export const rasdialTool: ToolDef = {
  name: 'rasdial',
  synopsis: 'Établit ou ferme une connexion VPN.',
  switches: ['/disconnect'],
  run(ctx, args) {
    const [name, second, third] = args
    if (!name) {
      const connected = ctx.host.host.vpnConnections.filter((c) => c.connected)
      if (connected.length === 0) ctx.write('Aucune connexion')
      else ctx.writeLines(['Connecté à', ...connected.map((c) => c.name)])
      ctx.write('La commande s’est terminée correctement.')
      return
    }
    if (second?.toLowerCase() === '/disconnect' || second?.toLowerCase() === '/d') {
      try {
        ctx.apply(vpnDisconnect(ctx.state, ctx.deviceId, name))
      } catch (e) {
        if (e instanceof CommandFailure && e.code === 'VpnNotConnected') {
          ctx.write('Aucune connexion', 'error')
          return
        }
        throw e
      }
      ctx.write('La commande s’est terminée correctement.')
      return
    }
    ctx.write(`Connexion à ${name}...`)
    const r = vpnConnect(ctx.state, ctx.deviceId, name, { user: second ?? '', password: third ?? '' })
    ctx.addTrace(r.trace)
    if (!r.ok) {
      ctx.write(r.message, 'error')
      ctx.state = r.state
      return
    }
    ctx.state = r.state
    ctx.writeLines([
      'Vérification du nom d’utilisateur et du mot de passe...',
      'Inscription de votre ordinateur sur le réseau...',
      `Connexion établie avec ${name}.`,
      'La commande s’est terminée correctement.'
    ])
  }
}
