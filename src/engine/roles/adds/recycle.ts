/**
 * Corbeille Active Directory : cmdlets Enable-ADOptionalFeature, Get-ADOptionalFeature,
 * Get-ADObject (objets supprimés) et Restore-ADObject.
 */
import { guidFromSeed } from '../../core/guid'
import type { DeletedAdObject, Domain } from '../../model/schema'
import { psError } from '../../shell/ps/errors'
import type { CmdContext } from '../../shell/ps/interpreter'
import type { CmdletDef } from '../../shell/ps/registry'
import { isPsObject, psObject, psToString, wildcardToRegExp, type PsValue } from '../../shell/ps/values'
import { hasFeature } from '../../shell/ps/cmdlets/helpers'
import { domainDn, isDomainAdmin, resolveContainerDn } from './directory'
import { enableRecycleBin, restoreDeletedObject } from './objects'

const available = (ctx: CmdContext) => hasFeature(ctx, 'RSAT-AD-PowerShell')
const str = (v: PsValue | undefined): string => psToString(v)
const RECYCLE_BIN = 'Recycle Bin Feature'

/** Domaine de l'ordinateur, contrôleur joignable ; écriture réservée aux Admins du domaine. */
function domainOf(ctx: CmdContext, write = false): Domain {
  const name = ctx.host.host.domain
  const domain = name ? ctx.state.domains[name] : undefined
  if (!domain || !domain.controllers.some((id) => ctx.state.devices[id]?.powered))
    throw psError(
      'Impossible de trouver un serveur par défaut sur lequel les services Web Active Directory s’exécutent.',
      'ResourceUnavailable',
      'ActiveDirectoryServer:0'
    )
  if (write && (!ctx.user.domain || !isDomainAdmin(domain, ctx.user.name)))
    throw psError(
      'Accès refusé',
      'PermissionDenied',
      'ActiveDirectoryCmdlet:System.UnauthorizedAccessException'
    )
  return domain
}

const CLASS: Record<DeletedAdObject['kind'], string> = {
  user: 'user',
  group: 'group',
  computer: 'computer',
  container: 'organizationalUnit'
}

function deletedObject(domain: Domain, d: DeletedAdObject) {
  const guid = guidFromSeed(d.obj.id)
  return psObject(
    'Microsoft.ActiveDirectory.Management.ADObject',
    {
      Deleted: true,
      DistinguishedName: `CN=${d.obj.name}\\0ADEL:${guid},CN=Deleted Objects,${domainDn(domain)}`,
      Name: `${d.obj.name}\nDEL:${guid}`,
      ObjectClass: CLASS[d.kind],
      ObjectGUID: guid,
      Id: d.obj.id
    },
    { kind: 'list', props: ['Deleted', 'DistinguishedName', 'Name', 'ObjectClass', 'ObjectGUID'] }
  )
}

/** Filtre -Filter simplifié : isDeleted, Name -like, SamAccountName -eq. */
function matches(d: DeletedAdObject, filter: string): boolean {
  const like = /Name\s+-like\s+['"]([^'"]+)['"]/i.exec(filter)
  if (like && !wildcardToRegExp(like[1] ?? '*').test(d.obj.name)) return false
  const sam = /SamAccountName\s+-eq\s+['"]([^'"]+)['"]/i.exec(filter)
  if (sam && !('sam' in d.obj && d.obj.sam.toLowerCase() === (sam[1] ?? '').toLowerCase())) return false
  return true
}

export const recycleBinCmdlets: CmdletDef[] = [
  {
    name: 'Enable-ADOptionalFeature',
    module: 'ActiveDirectory',
    synopsis: 'Active une fonctionnalité facultative d’Active Directory (Corbeille).',
    available,
    params: [
      { name: 'Identity', type: 'string', mandatory: true, position: 0 },
      { name: 'Scope', type: 'string', mandatory: true, validateSet: ['ForestOrConfigurationSet', 'Domain'] },
      { name: 'Target', type: 'string', mandatory: true }
    ],
    run(ctx, args) {
      const domain = domainOf(ctx, true)
      if (str(args['Identity']).toLowerCase() !== RECYCLE_BIN.toLowerCase())
        throw psError(
          `La fonctionnalité facultative « ${str(args['Identity'])} » est introuvable.`,
          'ObjectNotFound',
          'ActiveDirectoryCmdlet:ADIdentityNotFoundException'
        )
      if (!ctx.confirm(RECYCLE_BIN, 'Enable')) return
      ctx.write(
        'AVERTISSEMENT : L’activation de la Corbeille est irréversible : une fois activée, elle ne peut pas être désactivée.',
        'warning'
      )
      ctx.apply(enableRecycleBin(ctx.state, domain.name))
    }
  },
  {
    name: 'Get-ADOptionalFeature',
    module: 'ActiveDirectory',
    synopsis: 'Affiche les fonctionnalités facultatives d’Active Directory.',
    available,
    params: [
      { name: 'Identity', type: 'string', position: 0 },
      { name: 'Filter', type: 'string' }
    ],
    run(ctx) {
      const domain = domainOf(ctx)
      return [
        psObject(
          'Microsoft.ActiveDirectory.Management.ADOptionalFeature',
          {
            Name: RECYCLE_BIN,
            EnabledScopes: domain.recycleBin ? `{CN=Partitions,CN=Configuration,${domainDn(domain)}}` : '{}',
            FeatureScope: '{ForestOrConfigurationSet}',
            IsDisableable: false,
            RequiredForestMode: 'Windows2008R2Forest'
          },
          {
            kind: 'list',
            props: ['Name', 'EnabledScopes', 'FeatureScope', 'IsDisableable', 'RequiredForestMode']
          }
        )
      ]
    }
  },
  {
    name: 'Get-ADObject',
    module: 'ActiveDirectory',
    synopsis: 'Obtient des objets Active Directory (objets supprimés avec -IncludeDeletedObjects).',
    available,
    params: [
      { name: 'Filter', type: 'string', position: 0 },
      { name: 'Identity', type: 'string' },
      { name: 'IncludeDeletedObjects', type: 'switch' },
      { name: 'Properties', type: 'string[]' }
    ],
    run(ctx, args) {
      const domain = domainOf(ctx)
      if (args['IncludeDeletedObjects'] !== true)
        throw psError(
          'Utilisez Get-ADUser, Get-ADGroup ou Get-ADComputer ; Get-ADObject n’est simulé que pour les objets supprimés (-IncludeDeletedObjects).',
          'NotImplemented',
          'ActiveDirectoryCmdlet:NotSupported'
        )
      const filter = args['Filter'] ? str(args['Filter']) : '*'
      const identity = args['Identity'] ? str(args['Identity']).toLowerCase() : null
      return domain.deletedObjects
        .filter((d) => matches(d, filter))
        .filter((d) => !identity || guidFromSeed(d.obj.id).toLowerCase() === identity)
        .map((d) => deletedObject(domain, d))
    }
  },
  {
    name: 'Restore-ADObject',
    module: 'ActiveDirectory',
    synopsis: 'Restaure un objet supprimé de la Corbeille Active Directory.',
    available,
    params: [
      { name: 'Identity', type: 'any', pipeline: true, mandatory: true, position: 0 },
      { name: 'TargetPath', type: 'string' },
      { name: 'NewName', type: 'string' }
    ],
    run(ctx, args, input) {
      const domain = domainOf(ctx, true)
      const values = [...(args['Identity'] !== undefined ? [args['Identity']] : []), ...input]
      for (const v of values) {
        const key = isPsObject(v) ? str(v.props['ObjectGUID']) : str(v)
        const entry = domain.deletedObjects.find(
          (d) => guidFromSeed(d.obj.id).toLowerCase() === key.toLowerCase() || d.obj.id === key
        )
        if (!entry)
          throw psError(
            `Impossible de trouver un objet avec l’identité « ${key} » sous « CN=Deleted Objects,${domainDn(domain)} ».`,
            'ObjectNotFound',
            'ActiveDirectoryCmdlet:ADIdentityNotFoundException',
            key
          )
        let target: string | null | undefined
        if (args['TargetPath']) {
          target = resolveContainerDn(domain, str(args['TargetPath']))
          if (target === undefined)
            throw psError(
              `Le conteneur « ${str(args['TargetPath'])} » est introuvable.`,
              'ObjectNotFound',
              'TargetPath'
            )
        }
        ctx.apply(restoreDeletedObject(ctx.state, domain.name, entry.obj.id, target))
      }
    }
  }
]
