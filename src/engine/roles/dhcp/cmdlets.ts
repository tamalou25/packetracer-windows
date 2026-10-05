/**
 * Cmdlets du module DhcpServer (disponible avec les outils RSAT-DHCP).
 */
import { formatShortDate } from '../../core/clock'
import type { DhcpServer, ServerDevice } from '../../model/schema'
import {
  addExclusion,
  addReservation,
  addScope,
  formatLeaseDuration,
  removeReservation,
  removeScope,
  setDhcpOptions,
  setScopeState
} from './server'
import { authorizeDhcpServer } from './authorization'
import { prefixToMask } from '../../net/ipv4'
import { psError } from '../../shell/ps/errors'
import type { CmdContext } from '../../shell/ps/interpreter'
import type { CmdletDef } from '../../shell/ps/registry'
import { flatten, psObject, psToString, type PsValue } from '../../shell/ps/values'
import { hasFeature } from '../../shell/ps/cmdlets/helpers'

const available = (ctx: CmdContext) => hasFeature(ctx, 'RSAT-DHCP')

/** Données DHCP du serveur courant (rôle installé). */
function dhcpOf(ctx: CmdContext): { server: ServerDevice; dhcp: DhcpServer } {
  const d = ctx.device
  if (d.kind !== 'server' || !d.host.features.includes('DHCP') || !d.services.dhcp)
    throw psError(
      `Échec de la connexion au serveur DHCP ${d.name}. Le service Serveur DHCP n’est pas installé ou n’est pas démarré.`,
      'ObjectNotFound',
      'WIN32 1753',
      d.name
    )
  return { server: d, dhcp: d.services.dhcp }
}

function scopeIds(ctx: CmdContext): string[] {
  const d = ctx.state.devices[ctx.session.deviceId]
  return d?.kind === 'server' ? (d.services.dhcp?.scopes.map((s) => s.scopeId) ?? []) : []
}

const scopeParam = { name: 'ScopeId', type: 'string' as const, complete: scopeIds }
const computerParam = { name: 'ComputerName', type: 'string' as const, aliases: ['Cn'] }

const str = (v: PsValue | undefined): string => psToString(v)

export const dhcpCmdlets: CmdletDef[] = [
  {
    name: 'Add-DhcpServerv4Scope',
    module: 'DhcpServer',
    synopsis: 'Crée une étendue IPv4.',
    available,
    params: [
      { name: 'Name', type: 'string', mandatory: true },
      { name: 'StartRange', type: 'string', mandatory: true },
      { name: 'EndRange', type: 'string', mandatory: true },
      { name: 'SubnetMask', type: 'string', mandatory: true },
      { name: 'State', type: 'string', validateSet: ['Active', 'InActive'] },
      { name: 'LeaseDuration', type: 'string' },
      { name: 'Description', type: 'string' },
      computerParam
    ],
    run(ctx, args) {
      dhcpOf(ctx)
      ctx.apply(
        addScope(ctx.state, ctx.deviceId, {
          name: str(args['Name']),
          start: str(args['StartRange']),
          end: str(args['EndRange']),
          mask: str(args['SubnetMask']),
          description: str(args['Description']),
          state: args['State'] === 'InActive' ? 'Inactive' : 'Active',
          ...(args['LeaseDuration'] ? { leaseDuration: str(args['LeaseDuration']) } : {})
        })
      )
    }
  },
  {
    name: 'Get-DhcpServerv4Scope',
    module: 'DhcpServer',
    synopsis: 'Liste les étendues IPv4.',
    available,
    params: [{ ...scopeParam, position: 0 }, computerParam],
    run(ctx, args) {
      const { dhcp } = dhcpOf(ctx)
      const id = args['ScopeId'] ? str(args['ScopeId']) : null
      const scopes = dhcp.scopes.filter((s) => !id || s.scopeId === id)
      if (id && scopes.length === 0)
        throw psError(`L’étendue ${id} n’existe pas sur le serveur DHCP.`, 'ObjectNotFound', 'DHCP 20022', id)
      return scopes.map((s) =>
        psObject(
          'DhcpServerv4Scope',
          {
            ScopeId: s.scopeId,
            SubnetMask: prefixToMask(s.prefixLength),
            Name: s.name,
            State: s.state === 'Active' ? 'Active' : 'Inactive',
            StartRange: s.start,
            EndRange: s.end,
            LeaseDuration: formatLeaseDuration(s.leaseDurationSec)
          },
          {
            kind: 'table',
            props: ['ScopeId', 'SubnetMask', 'Name', 'State', 'StartRange', 'EndRange', 'LeaseDuration']
          }
        )
      )
    }
  },
  {
    name: 'Set-DhcpServerv4Scope',
    module: 'DhcpServer',
    synopsis: 'Active ou désactive une étendue.',
    available,
    params: [
      { ...scopeParam, mandatory: true, position: 0 },
      { name: 'State', type: 'string', validateSet: ['Active', 'InActive'] },
      computerParam
    ],
    run(ctx, args) {
      dhcpOf(ctx)
      if (args['State'])
        ctx.apply(setScopeState(ctx.state, ctx.deviceId, str(args['ScopeId']), args['State'] === 'Active'))
    }
  },
  {
    name: 'Remove-DhcpServerv4Scope',
    module: 'DhcpServer',
    synopsis: 'Supprime une étendue.',
    available,
    params: [
      { ...scopeParam, mandatory: true, position: 0 },
      { name: 'Force', type: 'switch' },
      computerParam
    ],
    run(ctx, args) {
      dhcpOf(ctx)
      const id = str(args['ScopeId'])
      if (ctx.confirm(`Étendue ${id}`, 'Supprimer l’étendue'))
        ctx.apply(removeScope(ctx.state, ctx.deviceId, id))
    }
  },
  {
    name: 'Add-DhcpServerv4ExclusionRange',
    module: 'DhcpServer',
    synopsis: 'Ajoute une plage d’exclusion à une étendue.',
    available,
    params: [
      { ...scopeParam, mandatory: true, position: 0 },
      { name: 'StartRange', type: 'string', mandatory: true },
      { name: 'EndRange', type: 'string', mandatory: true },
      computerParam
    ],
    run(ctx, args) {
      dhcpOf(ctx)
      ctx.apply(
        addExclusion(
          ctx.state,
          ctx.deviceId,
          str(args['ScopeId']),
          str(args['StartRange']),
          str(args['EndRange'])
        )
      )
    }
  },
  {
    name: 'Get-DhcpServerv4ExclusionRange',
    module: 'DhcpServer',
    synopsis: 'Liste les plages d’exclusion.',
    available,
    params: [{ ...scopeParam, position: 0 }, computerParam],
    run(ctx, args) {
      const { dhcp } = dhcpOf(ctx)
      const id = args['ScopeId'] ? str(args['ScopeId']) : null
      return dhcp.scopes
        .filter((s) => !id || s.scopeId === id)
        .flatMap((s) =>
          s.exclusions.map((e) =>
            psObject(
              'DhcpServerv4ExclusionRange',
              { ScopeId: s.scopeId, StartRange: e.start, EndRange: e.end },
              { kind: 'table', props: ['ScopeId', 'StartRange', 'EndRange'] }
            )
          )
        )
    }
  },
  {
    name: 'Add-DhcpServerv4Reservation',
    module: 'DhcpServer',
    synopsis: 'Réserve une adresse pour une adresse MAC.',
    available,
    params: [
      { ...scopeParam, mandatory: true, position: 0 },
      { name: 'IPAddress', type: 'string', mandatory: true },
      { name: 'ClientId', type: 'string', mandatory: true },
      { name: 'Name', type: 'string' },
      { name: 'Description', type: 'string' },
      computerParam
    ],
    run(ctx, args) {
      dhcpOf(ctx)
      ctx.apply(
        addReservation(ctx.state, ctx.deviceId, str(args['ScopeId']), {
          ip: str(args['IPAddress']),
          mac: str(args['ClientId']),
          name: str(args['Name']),
          description: str(args['Description'])
        })
      )
    }
  },
  {
    name: 'Get-DhcpServerv4Reservation',
    module: 'DhcpServer',
    synopsis: 'Liste les réservations d’une étendue.',
    available,
    params: [{ ...scopeParam, position: 0 }, computerParam],
    run(ctx, args) {
      const { dhcp } = dhcpOf(ctx)
      const id = args['ScopeId'] ? str(args['ScopeId']) : null
      return dhcp.scopes
        .filter((s) => !id || s.scopeId === id)
        .flatMap((s) =>
          s.reservations.map((r) =>
            psObject(
              'DhcpServerv4Reservation',
              {
                IPAddress: r.ip,
                ScopeId: s.scopeId,
                ClientId: r.mac.toLowerCase(),
                Name: r.name,
                Type: 'Both',
                Description: r.description
              },
              { kind: 'table', props: ['IPAddress', 'ScopeId', 'ClientId', 'Name', 'Type', 'Description'] }
            )
          )
        )
    }
  },
  {
    name: 'Remove-DhcpServerv4Reservation',
    module: 'DhcpServer',
    synopsis: 'Supprime une réservation.',
    available,
    params: [
      { ...scopeParam, mandatory: true, position: 0 },
      { name: 'ClientId', type: 'string' },
      { name: 'IPAddress', type: 'string' },
      computerParam
    ],
    run(ctx, args) {
      dhcpOf(ctx)
      const key = str(args['IPAddress'] ?? args['ClientId'])
      ctx.apply(removeReservation(ctx.state, ctx.deviceId, str(args['ScopeId']), key))
    }
  },
  {
    name: 'Set-DhcpServerv4OptionValue',
    module: 'DhcpServer',
    synopsis: 'Définit les options 003 (routeur), 006 (DNS) et 015 (domaine).',
    available,
    params: [
      scopeParam,
      { name: 'Router', type: 'string[]' },
      { name: 'DnsServer', type: 'string[]' },
      { name: 'DnsDomain', type: 'string' },
      { name: 'Force', type: 'switch' },
      computerParam
    ],
    run(ctx, args) {
      dhcpOf(ctx)
      ctx.apply(
        setDhcpOptions(ctx.state, ctx.deviceId, args['ScopeId'] ? str(args['ScopeId']) : null, {
          ...(args['Router'] ? { router: flatten([args['Router']]).map(psToString) } : {}),
          ...(args['DnsServer'] ? { dnsServers: flatten([args['DnsServer']]).map(psToString) } : {}),
          ...(args['DnsDomain'] !== undefined ? { dnsDomain: str(args['DnsDomain']) } : {}),
          force: args['Force'] === true
        })
      )
    }
  },
  {
    name: 'Get-DhcpServerv4OptionValue',
    module: 'DhcpServer',
    synopsis: 'Affiche les options d’une étendue ou du serveur.',
    available,
    params: [scopeParam, computerParam],
    run(ctx, args) {
      const { dhcp } = dhcpOf(ctx)
      const id = args['ScopeId'] ? str(args['ScopeId']) : null
      const options = id ? (dhcp.scopes.find((s) => s.scopeId === id)?.options ?? null) : dhcp.serverOptions
      if (!options)
        throw psError(
          `L’étendue ${id} n’existe pas sur le serveur DHCP.`,
          'ObjectNotFound',
          'DHCP 20022',
          id ?? ''
        )
      const rows: [number, string, string[]][] = [
        [3, 'Routeur', options.router],
        [6, 'Serveurs DNS', options.dnsServers],
        [15, 'Nom de domaine DNS', options.dnsDomain ? [options.dnsDomain] : []]
      ]
      return rows
        .filter(([, , v]) => v.length > 0)
        .map(([idOpt, name, value]) =>
          psObject(
            'DhcpOptionValue',
            { OptionId: idOpt, Name: name, Type: idOpt === 15 ? 'String' : 'IPv4Address', Value: value },
            { kind: 'table', props: ['OptionId', 'Name', 'Type', 'Value'] }
          )
        )
    }
  },
  {
    name: 'Get-DhcpServerv4Lease',
    module: 'DhcpServer',
    synopsis: 'Liste les baux d’une étendue.',
    available,
    params: [{ ...scopeParam, position: 0 }, computerParam],
    run(ctx, args) {
      const { dhcp } = dhcpOf(ctx)
      const id = args['ScopeId'] ? str(args['ScopeId']) : null
      return dhcp.scopes
        .filter((s) => !id || s.scopeId === id)
        .flatMap((s) =>
          s.leases.map((l) =>
            psObject(
              'DhcpServerv4Lease',
              {
                IPAddress: l.ip,
                ScopeId: s.scopeId,
                ClientId: l.mac.toLowerCase(),
                HostName: l.hostName,
                AddressState:
                  l.state === 'BadAddress'
                    ? 'Declined'
                    : s.reservations.some((r) => r.ip === l.ip)
                      ? 'ActiveReservation'
                      : 'Active',
                LeaseExpiryTime: formatShortDate(l.expiresAt)
              },
              {
                kind: 'table',
                props: ['IPAddress', 'ScopeId', 'ClientId', 'HostName', 'AddressState', 'LeaseExpiryTime']
              }
            )
          )
        )
    }
  },
  {
    name: 'Add-DhcpServerInDC',
    module: 'DhcpServer',
    synopsis: 'Autorise le serveur DHCP dans Active Directory.',
    available,
    params: [
      { name: 'DnsName', type: 'string', position: 0 },
      { name: 'IPAddress', type: 'string', position: 1 }
    ],
    run(ctx) {
      dhcpOf(ctx)
      ctx.apply(authorizeDhcpServer(ctx.state, ctx.deviceId, true))
    }
  },
  {
    name: 'Get-DhcpServerInDC',
    module: 'DhcpServer',
    synopsis: 'Liste les serveurs DHCP autorisés dans Active Directory.',
    available,
    params: [],
    run(ctx) {
      const domain = ctx.host.host.domain
      if (!domain)
        throw psError(
          'Impossible de contacter le service d’annuaire Active Directory : cet ordinateur n’est pas membre d’un domaine.',
          'ObjectNotFound',
          'DHCP 20070'
        )
      return Object.values(ctx.state.devices)
        .filter(
          (d): d is ServerDevice =>
            d.kind === 'server' && d.host.domain === domain && !!d.services.dhcp?.authorized
        )
        .map((d) =>
          psObject(
            'DhcpServerInDC',
            {
              IPAddress: d.interfaces.find((i) => i.address)?.address ?? '',
              DnsName: `${d.name.toLowerCase()}.${domain}`
            },
            { kind: 'table', props: ['IPAddress', 'DnsName'] }
          )
        )
    }
  }
]
