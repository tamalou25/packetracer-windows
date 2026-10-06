/**
 * Cmdlets du module GroupPolicy (installé avec la Gestion des stratégies de groupe) :
 * objets GPO, liaisons, héritage, filtrage de sécurité et actualisation.
 */
import { formatShortDate } from '../../core/clock'
import type { Domain, Gpo } from '../../model/schema'
import { AUTHENTICATED_USERS_SID } from '../../model/schema'
import { containerDn, isDomainAdmin, objectById, resolveContainerDn } from '../adds/directory'
import {
  createGpo,
  deleteGpo,
  linkGpo,
  renameGpo,
  resolveFilterPrincipal,
  setGpoSecurityFilter,
  setInheritanceBlocked,
  unlinkGpo,
  updateGpoLink
} from './objects'
import { processGroupPolicy, GP_NO_DC_MESSAGE } from './processing'
import { findGpo, gpoPrecedence, linksAt } from './scope'
import { psError } from '../../shell/ps/errors'
import type { CmdContext } from '../../shell/ps/interpreter'
import type { BoundArgs, CmdletDef, ParamDef } from '../../shell/ps/registry'
import { psObject, psToString, type PsObject, type PsValue } from '../../shell/ps/values'
import { hasFeature } from '../../shell/ps/cmdlets/helpers'

const gpAvailable = (ctx: CmdContext) => hasFeature(ctx, 'GPMC')
const str = (v: PsValue | undefined): string => psToString(v)

/** Domaine de l'ordinateur ; `write` exige un administrateur du domaine. */
function gpDomain(ctx: CmdContext, write = false): Domain {
  const name = ctx.host.host.domain
  const domain = name ? ctx.state.domains[name] : undefined
  const dcUp = domain?.controllers.some((id) => ctx.state.devices[id]?.powered)
  if (!domain || !dcUp)
    throw psError(
      'Le domaine spécifié n’existe pas ou n’a pas pu être contacté.',
      'InvalidOperation',
      'System.ArgumentException,Microsoft.GroupPolicy.Commands',
      '',
      'ArgumentException'
    )
  if (write && (!ctx.user.domain || !isDomainAdmin(domain, ctx.user.name)))
    throw psError(
      'Accès refusé.',
      'PermissionDenied',
      'UnauthorizedAccessException',
      '',
      'UnauthorizedAccessException'
    )
  return domain
}

/** GPO désignée par -Name ou -Guid (erreur réaliste si introuvable). */
function gpoArg(domain: Domain, args: BoundArgs): Gpo {
  const value = args['Guid'] !== undefined ? str(args['Guid']) : str(args['Name'])
  const gpo = findGpo(domain, value)
  if (!gpo)
    throw psError(
      `L’objet de stratégie de groupe « ${value} » est introuvable dans le domaine ${domain.name}.`,
      'ObjectNotFound',
      'GpoWithNameNotFound',
      value,
      'ArgumentException'
    )
  return gpo
}

/** Cible d'une liaison (-Target « OU=Compta,DC=lab,DC=local ») : null = racine du domaine. */
function targetArg(domain: Domain, value: string): string | null {
  const id = resolveContainerDn(domain, value)
  if (id === undefined)
    throw psError(
      `La cible « ${value} » est introuvable : indiquez le nom unique (DN) du domaine ou d’une unité d’organisation.`,
      'ObjectNotFound',
      'TargetNotFound',
      value,
      'ArgumentException'
    )
  return id
}

const yesNo = (v: boolean) => (v ? 'Yes' : 'No')

function bareGuid(gpo: Gpo): string {
  return gpo.id.slice(1, -1).toLowerCase()
}

export function gpoObject(domain: Domain, gpo: Gpo): PsObject {
  return psObject(
    'Gpo',
    {
      DisplayName: gpo.name,
      DomainName: domain.name,
      Owner: `${domain.netbios}\\Admins du domaine`,
      Id: bareGuid(gpo),
      GpoStatus: gpo.status,
      Description: gpo.comment,
      CreationTime: formatShortDate(gpo.createdAt),
      ModificationTime: formatShortDate(gpo.modifiedAt),
      UserVersion: `AD Version: ${gpo.userVersion}, SysVol Version: ${gpo.userVersion}`,
      ComputerVersion: `AD Version: ${gpo.computerVersion}, SysVol Version: ${gpo.computerVersion}`,
      WmiFilter: null
    },
    {
      kind: 'list',
      props: [
        'DisplayName',
        'DomainName',
        'Owner',
        'Id',
        'GpoStatus',
        'Description',
        'CreationTime',
        'ModificationTime',
        'UserVersion',
        'ComputerVersion',
        'WmiFilter'
      ]
    }
  )
}

function linkObject(domain: Domain, gpo: Gpo, targetId: string | null): PsObject {
  const links = linksAt(domain, targetId)
  const index = links.findIndex((l) => l.gpoId === gpo.id)
  const link = links[index]
  return psObject(
    'GpoLink',
    {
      GpoId: bareGuid(gpo),
      DisplayName: gpo.name,
      Enabled: link?.enabled ?? false,
      Enforced: link?.enforced ?? false,
      Target: containerDn(domain, targetId),
      Order: index + 1
    },
    { kind: 'list', props: ['GpoId', 'DisplayName', 'Enabled', 'Enforced', 'Target', 'Order'] }
  )
}

function inheritanceObject(domain: Domain, targetId: string | null): PsObject {
  const container = targetId === null ? undefined : domain.containers.find((c) => c.id === targetId)
  const own = linksAt(domain, targetId)
    .map((l) => domain.gpos.find((g) => g.id === l.gpoId)?.name)
    .filter((n): n is string => !!n)
  const inherited = gpoPrecedence(domain, targetId).map((e) => e.gpo.name)
  return psObject(
    'Som',
    {
      Name: (container?.name ?? domain.name).toLowerCase(),
      ContainerType: container ? 'OU' : 'Domain',
      Path: containerDn(domain, targetId).toLowerCase(),
      GpoInheritanceBlocked: yesNo(container?.blockInheritance ?? false),
      GpoLinks: `{${own.join(', ')}}`,
      InheritedGpoLinks: `{${inherited.join(', ')}}`
    },
    {
      kind: 'list',
      props: ['Name', 'ContainerType', 'Path', 'GpoInheritanceBlocked', 'GpoLinks', 'InheritedGpoLinks']
    }
  )
}

/** Nom affiché d'un élément du filtrage de sécurité. */
function trusteeName(domain: Domain, principal: string): { name: string; type: string } {
  if (principal === AUTHENTICATED_USERS_SID)
    return { name: 'Utilisateurs authentifiés', type: 'WellKnownGroup' }
  const o = objectById(domain, principal)
  if (!o || o.kind === 'container') return { name: principal, type: 'Unknown' }
  const type = o.kind === 'user' ? 'User' : o.kind === 'group' ? 'Group' : 'Computer'
  return { name: o.obj.name, type }
}

function permissionObject(domain: Domain, name: string, type: string, permission: string): PsObject {
  return psObject(
    'GPPermission',
    { Trustee: name, TrusteeType: type, Permission: permission, Inherited: false, Domain: domain.netbios },
    { kind: 'list', props: ['Trustee', 'TrusteeType', 'Permission', 'Inherited'] }
  )
}

const nameParam: ParamDef = { name: 'Name', type: 'string', position: 0, aliases: ['DisplayName'] }
const guidParam: ParamDef = { name: 'Guid', type: 'string', aliases: ['Id'] }
const yesNoSet = ['Yes', 'No', 'Unspecified']

/** Valeur -LinkEnabled / -Enforced (Yes, No) : undefined si non précisée. */
function yesNoArg(v: PsValue | undefined): boolean | undefined {
  if (v === undefined) return undefined
  const s = str(v).toLowerCase()
  if (s === 'unspecified') return undefined
  return s === 'yes' || s === 'true'
}

export const gpoCmdlets: CmdletDef[] = [
  {
    name: 'New-GPO',
    module: 'GroupPolicy',
    synopsis: 'Crée un objet de stratégie de groupe (GPO).',
    available: gpAvailable,
    params: [
      { ...nameParam, mandatory: true },
      { name: 'Comment', type: 'string' },
      { name: 'Domain', type: 'string' }
    ],
    run(ctx, args) {
      const domain = gpDomain(ctx, true)
      const id = ctx.apply(
        createGpo(ctx.state, domain.name, { name: str(args['Name']), comment: str(args['Comment']) })
      )
      const d = ctx.state.domains[domain.name] as Domain
      const gpo = d.gpos.find((g) => g.id === id)
      return gpo ? [gpoObject(d, gpo)] : []
    }
  },
  {
    name: 'Get-GPO',
    module: 'GroupPolicy',
    synopsis: 'Obtient un ou tous les objets de stratégie de groupe du domaine.',
    available: gpAvailable,
    params: [nameParam, guidParam, { name: 'All', type: 'switch' }, { name: 'Domain', type: 'string' }],
    run(ctx, args) {
      const domain = gpDomain(ctx)
      if (args['All'] === true) return domain.gpos.map((g) => gpoObject(domain, g))
      if (args['Name'] === undefined && args['Guid'] === undefined)
        throw psError(
          'Spécifiez -Name, -Guid ou -All.',
          'InvalidArgument',
          'AmbiguousParameterSet',
          '',
          'ParameterBindingException'
        )
      return [gpoObject(domain, gpoArg(domain, args))]
    }
  },
  {
    name: 'Remove-GPO',
    module: 'GroupPolicy',
    synopsis: 'Supprime un objet de stratégie de groupe et ses liaisons.',
    available: gpAvailable,
    params: [nameParam, guidParam],
    run(ctx, args) {
      const domain = gpDomain(ctx, true)
      const gpo = gpoArg(domain, args)
      if (!ctx.confirm(gpo.name, 'Remove-GPO')) return []
      ctx.apply(deleteGpo(ctx.state, domain.name, gpo.id))
      return []
    }
  },
  {
    name: 'Rename-GPO',
    module: 'GroupPolicy',
    synopsis: 'Renomme un objet de stratégie de groupe.',
    available: gpAvailable,
    params: [nameParam, guidParam, { name: 'TargetName', type: 'string', mandatory: true, position: 1 }],
    run(ctx, args) {
      const domain = gpDomain(ctx, true)
      const gpo = gpoArg(domain, args)
      ctx.apply(renameGpo(ctx.state, domain.name, gpo.id, str(args['TargetName'])))
      const d = ctx.state.domains[domain.name] as Domain
      const renamed = d.gpos.find((g) => g.id === gpo.id)
      return renamed ? [gpoObject(d, renamed)] : []
    }
  },
  {
    name: 'New-GPLink',
    module: 'GroupPolicy',
    synopsis: 'Lie une GPO à un domaine ou à une unité d’organisation.',
    available: gpAvailable,
    params: [
      nameParam,
      guidParam,
      { name: 'Target', type: 'string', mandatory: true, position: 1 },
      { name: 'LinkEnabled', type: 'string', validateSet: yesNoSet },
      { name: 'Enforced', type: 'string', validateSet: yesNoSet },
      { name: 'Order', type: 'int' }
    ],
    run(ctx, args) {
      const domain = gpDomain(ctx, true)
      const gpo = gpoArg(domain, args)
      const targetId = targetArg(domain, str(args['Target']))
      const enabled = yesNoArg(args['LinkEnabled'])
      const enforced = yesNoArg(args['Enforced'])
      ctx.apply(
        linkGpo(ctx.state, domain.name, gpo.id, targetId, {
          ...(enabled !== undefined ? { enabled } : {}),
          ...(enforced !== undefined ? { enforced } : {}),
          ...(args['Order'] !== undefined ? { order: Number(args['Order']) } : {})
        })
      )
      return [linkObject(ctx.state.domains[domain.name] as Domain, gpo, targetId)]
    }
  },
  {
    name: 'Set-GPLink',
    module: 'GroupPolicy',
    synopsis: 'Modifie une liaison : activation, application forcée, ordre.',
    available: gpAvailable,
    params: [
      nameParam,
      guidParam,
      { name: 'Target', type: 'string', mandatory: true, position: 1 },
      { name: 'LinkEnabled', type: 'string', validateSet: yesNoSet },
      { name: 'Enforced', type: 'string', validateSet: yesNoSet },
      { name: 'Order', type: 'int' }
    ],
    run(ctx, args) {
      const domain = gpDomain(ctx, true)
      const gpo = gpoArg(domain, args)
      const targetId = targetArg(domain, str(args['Target']))
      const enabled = yesNoArg(args['LinkEnabled'])
      const enforced = yesNoArg(args['Enforced'])
      ctx.apply(
        updateGpoLink(ctx.state, domain.name, gpo.id, targetId, {
          ...(enabled !== undefined ? { enabled } : {}),
          ...(enforced !== undefined ? { enforced } : {}),
          ...(args['Order'] !== undefined ? { order: Number(args['Order']) } : {})
        })
      )
      return [linkObject(ctx.state.domains[domain.name] as Domain, gpo, targetId)]
    }
  },
  {
    name: 'Remove-GPLink',
    module: 'GroupPolicy',
    synopsis: 'Supprime la liaison d’une GPO (la GPO est conservée).',
    available: gpAvailable,
    params: [nameParam, guidParam, { name: 'Target', type: 'string', mandatory: true, position: 1 }],
    run(ctx, args) {
      const domain = gpDomain(ctx, true)
      const gpo = gpoArg(domain, args)
      ctx.apply(unlinkGpo(ctx.state, domain.name, gpo.id, targetArg(domain, str(args['Target']))))
      return []
    }
  },
  {
    name: 'Get-GPInheritance',
    module: 'GroupPolicy',
    synopsis: 'Affiche les GPO liées et héritées d’un domaine ou d’une OU.',
    available: gpAvailable,
    params: [{ name: 'Target', type: 'string', mandatory: true, position: 0 }],
    run(ctx, args) {
      const domain = gpDomain(ctx)
      return [inheritanceObject(domain, targetArg(domain, str(args['Target'])))]
    }
  },
  {
    name: 'Set-GPInheritance',
    module: 'GroupPolicy',
    synopsis: 'Bloque ou rétablit l’héritage des GPO sur une unité d’organisation.',
    available: gpAvailable,
    params: [
      { name: 'Target', type: 'string', mandatory: true, position: 0 },
      { name: 'IsBlocked', type: 'string', mandatory: true, position: 1, validateSet: ['Yes', 'No'] }
    ],
    run(ctx, args) {
      const domain = gpDomain(ctx, true)
      const targetId = targetArg(domain, str(args['Target']))
      if (targetId === null)
        throw psError(
          'Le blocage de l’héritage ne s’applique qu’à une unité d’organisation.',
          'InvalidArgument',
          'InvalidTarget',
          str(args['Target'])
        )
      ctx.apply(setInheritanceBlocked(ctx.state, domain.name, targetId, yesNoArg(args['IsBlocked']) === true))
      return [inheritanceObject(ctx.state.domains[domain.name] as Domain, targetId)]
    }
  },
  {
    name: 'Get-GPPermission',
    aliases: ['Get-GPPermissions'],
    module: 'GroupPolicy',
    synopsis: 'Affiche les autorisations (dont le filtrage de sécurité) d’une GPO.',
    available: gpAvailable,
    params: [
      nameParam,
      guidParam,
      { name: 'All', type: 'switch' },
      { name: 'TargetName', type: 'string' },
      { name: 'TargetType', type: 'string', validateSet: ['User', 'Group', 'Computer'] }
    ],
    run(ctx, args) {
      const domain = gpDomain(ctx)
      const gpo = gpoArg(domain, args)
      const entries = [
        ...gpo.securityFilter.map((p) => ({ ...trusteeName(domain, p), permission: 'GpoApply' })),
        { name: 'Admins du domaine', type: 'Group', permission: 'GpoEditDeleteModifySecurity' },
        { name: 'Administrateurs de l’entreprise', type: 'Group', permission: 'GpoEditDeleteModifySecurity' },
        { name: 'SYSTEM', type: 'WellKnownGroup', permission: 'GpoEditDeleteModifySecurity' },
        { name: 'CONTRÔLEURS DE DOMAINE D’ENTREPRISE', type: 'WellKnownGroup', permission: 'GpoRead' }
      ]
      const wanted = args['TargetName'] !== undefined ? str(args['TargetName']).toLowerCase() : null
      return entries
        .filter((e) => wanted === null || e.name.toLowerCase() === wanted)
        .map((e) => permissionObject(domain, e.name, e.type, e.permission))
    }
  },
  {
    name: 'Set-GPPermission',
    aliases: ['Set-GPPermissions'],
    module: 'GroupPolicy',
    synopsis: 'Accorde ou retire une autorisation (GpoApply = filtrage de sécurité).',
    available: gpAvailable,
    params: [
      nameParam,
      guidParam,
      { name: 'TargetName', type: 'string', mandatory: true },
      { name: 'TargetType', type: 'string', mandatory: true, validateSet: ['User', 'Group', 'Computer'] },
      {
        name: 'PermissionLevel',
        type: 'string',
        mandatory: true,
        validateSet: ['GpoRead', 'GpoApply', 'GpoEdit', 'GpoEditDeleteModifySecurity', 'None']
      },
      { name: 'Replace', type: 'switch' }
    ],
    run(ctx, args) {
      const domain = gpDomain(ctx, true)
      const gpo = gpoArg(domain, args)
      const target = str(args['TargetName'])
      const level = str(args['PermissionLevel']).toLowerCase()
      if (!resolveFilterPrincipal(domain, target))
        throw psError(
          `Le compte « ${target} » est introuvable dans le domaine ${domain.name}.`,
          'ObjectNotFound',
          'TrusteeNotFound',
          target,
          'ArgumentException'
        )
      const applies = gpo.securityFilter.includes(resolveFilterPrincipal(domain, target) ?? '')
      if (level === 'gpoapply') ctx.apply(setGpoSecurityFilter(ctx.state, domain.name, gpo.id, target, true))
      else if (applies) {
        // Niveau inférieur à GpoApply : le droit d'appliquer est retiré, avec -Replace uniquement
        if (args['Replace'] !== true)
          throw psError(
            `Le compte « ${target} » possède déjà une autorisation plus élevée : utilisez -Replace pour la réduire.`,
            'InvalidOperation',
            'PermissionLevelLower',
            target,
            'InvalidOperationException'
          )
        ctx.apply(setGpoSecurityFilter(ctx.state, domain.name, gpo.id, target, false))
      }
      const d = ctx.state.domains[domain.name] as Domain
      const trustee = trusteeName(d, resolveFilterPrincipal(d, target) ?? target)
      return level === 'none'
        ? []
        : [permissionObject(d, trustee.name, trustee.type, str(args['PermissionLevel']))]
    }
  },
  {
    name: 'Invoke-GPUpdate',
    module: 'GroupPolicy',
    synopsis: 'Actualise les stratégies de groupe de l’ordinateur local.',
    available: gpAvailable,
    params: [
      { name: 'Computer', type: 'string' },
      { name: 'Target', type: 'string', validateSet: ['Computer', 'User'] },
      { name: 'Force', type: 'switch' },
      { name: 'RandomDelayInMinutes', type: 'int' }
    ],
    run(ctx, args) {
      if (
        args['Computer'] !== undefined &&
        str(args['Computer']).toLowerCase() !== ctx.host.name.toLowerCase()
      )
        throw psError(
          'L’actualisation à distance n’est pas simulée : exécutez gpupdate sur l’ordinateur concerné.',
          'NotImplemented',
          'RemoteGpUpdateNotSupported',
          str(args['Computer'])
        )
      const target = args['Target'] !== undefined ? str(args['Target']).toLowerCase() : null
      const op = processGroupPolicy(ctx.state, ctx.deviceId, {
        computer: target !== 'user',
        user: target !== 'computer'
      })
      ctx.state = op.state
      ctx.addTrace(op.trace)
      if (op.computer === 'failed' || op.user === 'failed')
        throw psError(op.error ?? GP_NO_DC_MESSAGE, 'OperationStopped', 'GpUpdateFailed', ctx.host.name)
      return []
    }
  }
]
