/**
 * Cmdlets du pare-feu (module NetSecurity) et du profil réseau (NetConnection).
 */
import type { FirewallProfileName, FirewallRule, HostDevice } from '../../../model/schema'
import { FIREWALL_PROFILES } from '../../../model/schema'
import {
  activeProfile,
  effectiveRules,
  newFirewallRule,
  profileEnabled,
  removeFirewallRule,
  setFirewallProfile,
  setFirewallRuleEnabled,
  setNetworkCategory,
  type RuleSelector
} from '../../../services/firewall'
import { CommandFailure } from '../../context'
import { psError } from '../errors'
import type { CmdContext } from '../interpreter'
import type { BoundArgs, CmdletDef } from '../registry'
import { flatten, isPsObject, psObject, psToString, wildcardToRegExp, type PsValue } from '../values'

const MODULE = 'NetSecurity'

function host(ctx: CmdContext): HostDevice {
  return ctx.host
}

/** Valeur booléenne d'un paramètre (True, False, $true, $false). */
function boolArg(value: PsValue | undefined, name: string): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'boolean') return value
  const text = psToString(value).trim().toLowerCase()
  if (text === 'true' || text === '1') return true
  if (text === 'false' || text === '0') return false
  throw psError(
    `Impossible de lier le paramètre « ${name} ». La valeur « ${psToString(value)} » n’est pas valide : utilisez True ou False.`,
    'InvalidArgument',
    `ParameterArgumentValidationError,${name}`
  )
}

function list(value: PsValue | undefined): string[] {
  return flatten(value === undefined ? [] : [value])
    .flatMap((v) => psToString(v).split(','))
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Profils désignés par -Profile (Any = tous). */
function profilesArg(value: PsValue | undefined): FirewallProfileName[] {
  const names = list(value)
  if (names.some((n) => n.toLowerCase() === 'any' || n.toLowerCase() === 'all')) return [...FIREWALL_PROFILES]
  return names.map((n) => {
    const match = FIREWALL_PROFILES.find((p) => p.toLowerCase() === n.toLowerCase())
    if (!match)
      throw psError(
        `Impossible de lier le paramètre « Profile ». La valeur « ${n} » n’est pas valide (Domain, Private, Public, Any).`,
        'InvalidArgument',
        'ParameterArgumentValidationError,Profile'
      )
    return match
  })
}

function profileLabel(rule: FirewallRule): string {
  return rule.profiles.length === 0 || rule.profiles.length === 3 ? 'Any' : rule.profiles.join(', ')
}

function ruleObject(rule: FirewallRule & { source?: 'local' | 'gpo' }): PsValue {
  return psObject(
    'Microsoft.Management.Infrastructure.CimInstance#root/standardcimv2/MSFT_NetFirewallRule',
    {
      Name: rule.id,
      DisplayName: rule.displayName,
      DisplayGroup: rule.group,
      Enabled: rule.enabled ? 'True' : 'False',
      Profile: profileLabel(rule),
      Direction: rule.direction,
      Action: rule.action,
      PrimaryStatus: 'OK',
      PolicyStoreSourceType: rule.source === 'gpo' ? 'GroupPolicy' : 'Local'
    },
    {
      kind: 'list',
      props: [
        'Name',
        'DisplayName',
        'DisplayGroup',
        'Enabled',
        'Profile',
        'Direction',
        'Action',
        'PrimaryStatus',
        'PolicyStoreSourceType'
      ]
    }
  )
}

/** Sélecteurs -Name, -DisplayName, -DisplayGroup ou règles reçues du pipeline. */
function selectors(args: BoundArgs, input: PsValue[]): RuleSelector[] {
  const out: RuleSelector[] = []
  for (const name of list(args['Name'])) out.push({ name })
  for (const displayName of list(args['DisplayName'])) out.push({ displayName })
  for (const group of list(args['DisplayGroup'])) out.push({ group })
  for (const v of input) if (isPsObject(v)) out.push({ name: psToString(v.props['Name']) })
  if (out.length === 0)
    throw psError(
      'Indiquez la règle avec -Name, -DisplayName ou -DisplayGroup.',
      'InvalidArgument',
      'MissingRuleSelector'
    )
  return out
}

function notFound(selector: RuleSelector) {
  const [prop, value] = selector.name
    ? ['Name', selector.name]
    : selector.displayName
      ? ['DisplayName', selector.displayName]
      : ['DisplayGroup', selector.group ?? '']
  return psError(
    `Aucun objet MSFT_NetFirewallRule n’a été trouvé avec la propriété « ${prop} » égale à « ${value} ». Vérifiez la valeur de la propriété et réessayez.`,
    'ObjectNotFound',
    `CmdletizationQuery_NotFound_${prop},Get-NetFirewallRule`,
    value
  )
}

/** Applique une action à chaque sélecteur ; un sélecteur sans règle est une erreur. */
function eachSelector(args: BoundArgs, input: PsValue[], action: (selector: RuleSelector) => void): void {
  for (const selector of selectors(args, input)) {
    try {
      action(selector)
    } catch (e) {
      if (e instanceof CommandFailure && e.code === 'RuleNotFound') throw notFound(selector)
      throw e
    }
  }
}

const selectorParams = [
  { name: 'Name', type: 'string[]' as const, position: 0 },
  { name: 'DisplayName', type: 'string[]' as const },
  { name: 'DisplayGroup', type: 'string[]' as const },
  { name: 'InputObject', type: 'any' as const, pipeline: true }
]

export const firewallCmdlets: CmdletDef[] = [
  {
    name: 'Get-NetFirewallProfile',
    module: MODULE,
    synopsis: 'Affiche les profils du pare-feu (domaine, privé, public).',
    params: [
      { name: 'Name', type: 'string[]', position: 0, aliases: ['Profile'] },
      { name: 'PolicyStore', type: 'string' }
    ],
    run(ctx, args) {
      const names = args['Name'] ? profilesArg(args['Name']) : [...FIREWALL_PROFILES]
      const h = host(ctx)
      return names.map((name) =>
        psObject(
          'Microsoft.Management.Infrastructure.CimInstance#root/standardcimv2/MSFT_NetFirewallProfile',
          {
            Name: name,
            Enabled: profileEnabled(h, name) ? 'True' : 'False',
            DefaultInboundAction: h.host.firewall.profiles[name].defaultInbound,
            DefaultOutboundAction: h.host.firewall.profiles[name].defaultOutbound
          },
          { kind: 'list', props: ['Name', 'Enabled', 'DefaultInboundAction', 'DefaultOutboundAction'] }
        )
      )
    }
  },
  {
    name: 'Set-NetFirewallProfile',
    module: MODULE,
    synopsis: 'Active ou désactive des profils du pare-feu, ou change leurs actions par défaut.',
    params: [
      { name: 'Profile', type: 'string[]', position: 0, aliases: ['Name'] },
      { name: 'All', type: 'switch' },
      { name: 'Enabled', type: 'string' },
      { name: 'DefaultInboundAction', type: 'string', validateSet: ['Block', 'Allow', 'NotConfigured'] },
      { name: 'DefaultOutboundAction', type: 'string', validateSet: ['Block', 'Allow', 'NotConfigured'] }
    ],
    run(ctx, args) {
      const profiles = args['All'] === true ? [...FIREWALL_PROFILES] : profilesArg(args['Profile'])
      const action = (v: PsValue | undefined) => {
        const t = v === undefined ? '' : psToString(v)
        return t === 'Block' || t === 'Allow' ? t : t === 'NotConfigured' ? undefined : undefined
      }
      const inbound = action(args['DefaultInboundAction'])
      const outbound = action(args['DefaultOutboundAction'])
      const enabled = boolArg(args['Enabled'], 'Enabled')
      ctx.apply(
        setFirewallProfile(ctx.state, ctx.deviceId, profiles, {
          ...(enabled !== undefined ? { enabled } : {}),
          ...(inbound ? { defaultInbound: inbound } : {}),
          ...(outbound ? { defaultOutbound: outbound } : {})
        })
      )
    }
  },
  {
    name: 'Get-NetFirewallRule',
    module: MODULE,
    synopsis: 'Affiche les règles du pare-feu.',
    params: [
      { name: 'Name', type: 'string[]', position: 0, aliases: ['ID'] },
      { name: 'DisplayName', type: 'string[]' },
      { name: 'DisplayGroup', type: 'string[]' },
      { name: 'Enabled', type: 'string' },
      { name: 'Direction', type: 'string', validateSet: ['Inbound', 'Outbound'] },
      { name: 'Action', type: 'string', validateSet: ['Allow', 'Block'] },
      { name: 'PolicyStore', type: 'string' }
    ],
    run(ctx, args) {
      const match = (patterns: string[], value: string) =>
        patterns.length === 0 || patterns.some((p) => wildcardToRegExp(p).test(value))
      const names = list(args['Name'])
      const displayNames = list(args['DisplayName'])
      const groups = list(args['DisplayGroup'])
      const enabled = boolArg(args['Enabled'], 'Enabled')
      const rules = effectiveRules(host(ctx)).filter(
        (r) =>
          match(names, r.id) &&
          match(displayNames, r.displayName) &&
          match(groups, r.group) &&
          (enabled === undefined || r.enabled === enabled) &&
          (!args['Direction'] || r.direction === psToString(args['Direction'])) &&
          (!args['Action'] || r.action === psToString(args['Action']))
      )
      const exact = [...names, ...displayNames].find((p) => !/[*?]/.test(p))
      if (rules.length === 0 && exact)
        throw notFound(names.includes(exact) ? { name: exact } : { displayName: exact })
      return rules.map(ruleObject)
    }
  },
  {
    name: 'New-NetFirewallRule',
    module: MODULE,
    synopsis: 'Crée une règle de pare-feu entrante ou sortante.',
    params: [
      { name: 'DisplayName', type: 'string', mandatory: true, position: 0 },
      { name: 'Name', type: 'string', aliases: ['ID'] },
      { name: 'Direction', type: 'string', validateSet: ['Inbound', 'Outbound'] },
      { name: 'Action', type: 'string', validateSet: ['Allow', 'Block', 'NotConfigured'] },
      { name: 'Protocol', type: 'string' },
      { name: 'LocalPort', type: 'string[]' },
      { name: 'RemoteAddress', type: 'string[]' },
      { name: 'Profile', type: 'string[]' },
      { name: 'Enabled', type: 'string' },
      { name: 'Group', type: 'string' }
    ],
    run(ctx, args) {
      const raw = args['Protocol'] === undefined ? 'Any' : psToString(args['Protocol'])
      const protocol = (
        {
          tcp: 'TCP',
          '6': 'TCP',
          udp: 'UDP',
          '17': 'UDP',
          icmpv4: 'ICMPv4',
          '1': 'ICMPv4',
          any: 'Any'
        } as const
      )[raw.toLowerCase() as 'tcp']
      if (!protocol)
        throw psError(
          `La valeur « ${raw} » du paramètre Protocol n’est pas valide (TCP, UDP, ICMPv4, Any).`,
          'InvalidArgument',
          'HRESULT 0x80070057,New-NetFirewallRule'
        )
      const ports = list(args['LocalPort']).map((p) => {
        const n = Number(p)
        if (!Number.isInteger(n))
          throw psError(
            `La valeur « ${p} » du paramètre LocalPort n’est pas valide.`,
            'InvalidArgument',
            'HRESULT 0x80070057,New-NetFirewallRule'
          )
        return n
      })
      const enabled = boolArg(args['Enabled'], 'Enabled')
      const id = ctx.apply(
        newFirewallRule(ctx.state, ctx.deviceId, {
          displayName: psToString(args['DisplayName']),
          ...(args['Name'] ? { name: psToString(args['Name']) } : {}),
          direction: args['Direction'] === 'Outbound' ? 'Outbound' : 'Inbound',
          action: args['Action'] === 'Block' ? 'Block' : 'Allow',
          protocol,
          localPorts: ports,
          remoteAddresses: list(args['RemoteAddress']).filter((a) => a.toLowerCase() !== 'any'),
          profiles: args['Profile']
            ? profilesArg(args['Profile']).filter((_, __, all) => all.length < 3)
            : [],
          ...(enabled !== undefined ? { enabled } : {}),
          ...(args['Group'] ? { group: psToString(args['Group']) } : {})
        })
      )
      const rule = effectiveRules(host(ctx)).find((r) => r.id === id)
      return rule ? [ruleObject(rule)] : []
    }
  },
  {
    name: 'Enable-NetFirewallRule',
    module: MODULE,
    synopsis: 'Active des règles du pare-feu.',
    params: selectorParams,
    run(ctx, args, input) {
      eachSelector(args, input, (selector) =>
        ctx.apply(setFirewallRuleEnabled(ctx.state, ctx.deviceId, selector, true))
      )
    }
  },
  {
    name: 'Disable-NetFirewallRule',
    module: MODULE,
    synopsis: 'Désactive des règles du pare-feu.',
    params: selectorParams,
    run(ctx, args, input) {
      eachSelector(args, input, (selector) =>
        ctx.apply(setFirewallRuleEnabled(ctx.state, ctx.deviceId, selector, false))
      )
    }
  },
  {
    name: 'Set-NetFirewallRule',
    module: MODULE,
    synopsis: 'Modifie l’état de règles du pare-feu (-Enabled).',
    params: [...selectorParams, { name: 'Enabled', type: 'string' }],
    run(ctx, args, input) {
      const enabled = boolArg(args['Enabled'], 'Enabled')
      if (enabled === undefined) return
      eachSelector(args, input, (selector) =>
        ctx.apply(setFirewallRuleEnabled(ctx.state, ctx.deviceId, selector, enabled))
      )
    }
  },
  {
    name: 'Remove-NetFirewallRule',
    module: MODULE,
    synopsis: 'Supprime des règles du pare-feu créées localement.',
    params: selectorParams,
    run(ctx, args, input) {
      eachSelector(args, input, (selector) =>
        ctx.apply(removeFirewallRule(ctx.state, ctx.deviceId, selector))
      )
    }
  },
  {
    name: 'Get-NetConnectionProfile',
    module: 'NetConnection',
    synopsis: 'Affiche le profil réseau (domaine, privé, public) des connexions.',
    params: [{ name: 'InterfaceAlias', type: 'string' }],
    run(ctx) {
      const h = host(ctx)
      const profile = activeProfile(h)
      return h.interfaces
        .filter((i) => i.l3 && i.enabled)
        .map((i, index) =>
          psObject(
            'Microsoft.Management.Infrastructure.CimInstance#root/StandardCimv2/MSFT_NetConnectionProfile',
            {
              Name: h.host.domain ?? 'Réseau',
              InterfaceAlias: i.name,
              InterfaceIndex: index + 2,
              NetworkCategory: profile === 'Domain' ? 'DomainAuthenticated' : profile,
              IPv4Connectivity: 'LocalNetwork'
            },
            {
              kind: 'list',
              props: ['Name', 'InterfaceAlias', 'InterfaceIndex', 'NetworkCategory', 'IPv4Connectivity']
            }
          )
        )
    }
  },
  {
    name: 'Set-NetConnectionProfile',
    module: 'NetConnection',
    synopsis: 'Change la catégorie du réseau (privé ou public).',
    params: [
      { name: 'InterfaceAlias', type: 'string' },
      { name: 'NetworkCategory', type: 'string', mandatory: true, validateSet: ['Public', 'Private'] }
    ],
    run(ctx, args) {
      ctx.apply(
        setNetworkCategory(
          ctx.state,
          ctx.deviceId,
          args['NetworkCategory'] === 'Private' ? 'Private' : 'Public'
        )
      )
    }
  }
]
