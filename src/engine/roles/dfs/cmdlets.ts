/**
 * Cmdlets des modules DFSN (espaces de noms) et DFSR (réplication), outils de gestion DFS.
 */
import type { ServerDevice } from '../../model/schema'
import { psError } from '../../shell/ps/errors'
import type { CmdContext } from '../../shell/ps/interpreter'
import type { CmdletDef } from '../../shell/ps/registry'
import { psObject, psToString, type PsValue } from '../../shell/ps/values'
import { hasFeature } from '../../shell/ps/cmdlets/helpers'
import { parseUnc } from '../files/paths'
import {
  addFolderTarget,
  newNamespace,
  newNamespaceFolder,
  removeFolderTarget,
  removeNamespace,
  removeNamespaceFolder
} from './namespaces'
import {
  addReplicationMember,
  findGroup,
  newReplicatedFolder,
  newReplicationGroup,
  removeReplicationGroup,
  setMembership,
  syncReplicationGroup
} from './replication'
import { dfsOf, findNamespace } from './state'

const available = (ctx: CmdContext) => hasFeature(ctx, 'RSAT-DFS-Mgmt-Con')
const str = (v: PsValue | undefined): string => psToString(v)

/** Chemin \\domaine\racine[\dossier] : espace de noms existant (erreur sinon). */
function namespaceOf(ctx: CmdContext, path: string) {
  const unc = parseUnc(path)
  const found = unc?.share ? findNamespace(ctx.state, unc.server, unc.share) : null
  if (!unc || !found)
    throw psError(
      `Impossible de trouver l’espace de noms « ${path} ».`,
      'ObjectNotFound',
      'NamespaceNotFound',
      path
    )
  return { unc, ...found }
}

function folderObject(path: string, state: string, description = '') {
  return psObject(
    'Microsoft.Management.Infrastructure.CimInstance#DfsnFolder',
    { Path: path, State: state, Description: description },
    { kind: 'table', props: ['Path', 'State', 'Description'] }
  )
}

function targetObject(path: string, target: string) {
  return psObject(
    'Microsoft.Management.Infrastructure.CimInstance#DfsnFolderTarget',
    { Path: path, TargetPath: target, State: 'Online', ReferralPriorityClass: 'sitecost-normal' },
    { kind: 'table', props: ['Path', 'TargetPath', 'State', 'ReferralPriorityClass'] }
  )
}

export const dfsCmdlets: CmdletDef[] = [
  {
    name: 'New-DfsnRoot',
    module: 'DFSN',
    synopsis: 'Crée la racine d’un espace de noms DFS.',
    available,
    params: [
      { name: 'Path', type: 'string', mandatory: true },
      { name: 'TargetPath', type: 'string', mandatory: true },
      { name: 'Type', type: 'string', mandatory: true, validateSet: ['DomainV2', 'DomainV1', 'Standalone'] }
    ],
    run(ctx, args) {
      if (str(args['Type']) !== 'DomainV2')
        throw psError(
          'Seuls les espaces de noms de domaine (mode Windows Server 2008, DomainV2) sont simulés.',
          'InvalidArgument',
          'Type'
        )
      const path = parseUnc(str(args['Path']))
      const target = parseUnc(str(args['TargetPath']))
      if (!path?.share || !target?.share || path.rest.length > 0 || target.rest.length > 0)
        throw psError('Chemin d’espace de noms ou de cible non valide.', 'InvalidArgument', 'Path')
      const server = Object.values(ctx.state.devices).find(
        (d): d is ServerDevice =>
          d.kind === 'server' && d.name.toLowerCase() === target.server.split('.')[0]?.toLowerCase()
      )
      if (!server)
        throw psError(`L’ordinateur « ${target.server} » est introuvable.`, 'ObjectNotFound', 'TargetPath')
      if (target.share.toLowerCase() !== path.share.toLowerCase())
        throw psError(
          'Le partage cible doit porter le nom de la racine de l’espace de noms.',
          'InvalidArgument',
          'TargetPath'
        )
      if (server.host.domain?.toLowerCase() !== path.server.toLowerCase())
        throw psError(
          `Le domaine « ${path.server} » ne correspond pas à celui de ${server.name}.`,
          'InvalidArgument',
          'Path'
        )
      const created = ctx.apply(newNamespace(ctx.state, server.id, { name: path.share }))
      return [
        psObject(
          'Microsoft.Management.Infrastructure.CimInstance#DfsnRoot',
          { Path: created, Type: 'Domain V2', State: 'Online', Description: '' },
          { kind: 'table', props: ['Path', 'Type', 'State', 'Description'] }
        )
      ]
    }
  },
  {
    name: 'Get-DfsnRoot',
    module: 'DFSN',
    synopsis: 'Liste les racines d’espaces de noms.',
    available,
    params: [{ name: 'Path', type: 'string', position: 0 }],
    run(ctx, args) {
      const wanted = args['Path'] ? str(args['Path']).toLowerCase() : null
      return Object.values(ctx.state.devices).flatMap((d) =>
        d.kind === 'server'
          ? (dfsOf(d)?.namespaces ?? [])
              .map((n) => `\\\\${d.host.domain}\\${n.name}`)
              .filter((p) => !wanted || p.toLowerCase() === wanted)
              .map((p) =>
                psObject(
                  'Microsoft.Management.Infrastructure.CimInstance#DfsnRoot',
                  { Path: p, Type: 'Domain V2', State: 'Online', Description: '' },
                  { kind: 'table', props: ['Path', 'Type', 'State', 'Description'] }
                )
              )
          : []
      )
    }
  },
  {
    name: 'Remove-DfsnRoot',
    module: 'DFSN',
    synopsis: 'Supprime la racine d’un espace de noms.',
    available,
    params: [
      { name: 'Path', type: 'string', mandatory: true, position: 0 },
      { name: 'Force', type: 'switch' }
    ],
    run(ctx, args) {
      const { server, namespace } = namespaceOf(ctx, str(args['Path']))
      if (!ctx.confirm(str(args['Path']))) return
      ctx.apply(removeNamespace(ctx.state, server.id, namespace.name))
    }
  },
  {
    name: 'New-DfsnFolder',
    module: 'DFSN',
    synopsis: 'Crée un dossier dans un espace de noms.',
    available,
    params: [
      { name: 'Path', type: 'string', mandatory: true, position: 0 },
      { name: 'TargetPath', type: 'string', mandatory: true, position: 1 },
      { name: 'Description', type: 'string' }
    ],
    run(ctx, args) {
      const path = str(args['Path'])
      ctx.apply(newNamespaceFolder(ctx.state, path, str(args['TargetPath'])))
      return [folderObject(path, 'Online', args['Description'] ? str(args['Description']) : '')]
    }
  },
  {
    name: 'Get-DfsnFolder',
    module: 'DFSN',
    synopsis: 'Liste les dossiers d’un espace de noms (chemin avec caractère générique *).',
    available,
    params: [{ name: 'Path', type: 'string', mandatory: true, position: 0 }],
    run(ctx, args) {
      const path = str(args['Path'])
      const { unc, namespace } = namespaceOf(ctx, path.replace(/\\\*$/, ''))
      const base = `\\\\${unc.server}\\${namespace.name}`
      const wanted = path.endsWith('\\*') ? null : (unc.rest[0] ?? '').toLowerCase()
      const folders = namespace.folders.filter((f) => wanted === null || f.name.toLowerCase() === wanted)
      if (wanted !== null && folders.length === 0)
        throw psError(
          `Impossible de trouver le dossier « ${path} ».`,
          'ObjectNotFound',
          'FolderNotFound',
          path
        )
      return folders.map((f) => folderObject(`${base}\\${f.name}`, 'Online'))
    }
  },
  {
    name: 'Remove-DfsnFolder',
    module: 'DFSN',
    synopsis: 'Supprime un dossier d’un espace de noms.',
    available,
    params: [
      { name: 'Path', type: 'string', mandatory: true, position: 0 },
      { name: 'Force', type: 'switch' }
    ],
    run(ctx, args) {
      if (!ctx.confirm(str(args['Path']))) return
      ctx.apply(removeNamespaceFolder(ctx.state, str(args['Path'])))
    }
  },
  {
    name: 'New-DfsnFolderTarget',
    module: 'DFSN',
    synopsis: 'Ajoute une cible à un dossier d’espace de noms.',
    available,
    params: [
      { name: 'Path', type: 'string', mandatory: true, position: 0 },
      { name: 'TargetPath', type: 'string', mandatory: true, position: 1 }
    ],
    run(ctx, args) {
      const path = str(args['Path'])
      ctx.apply(addFolderTarget(ctx.state, path, str(args['TargetPath'])))
      return [targetObject(path, str(args['TargetPath']))]
    }
  },
  {
    name: 'Get-DfsnFolderTarget',
    module: 'DFSN',
    synopsis: 'Liste les cibles d’un dossier d’espace de noms.',
    available,
    params: [{ name: 'Path', type: 'string', mandatory: true, position: 0 }],
    run(ctx, args) {
      const path = str(args['Path'])
      const { unc, namespace } = namespaceOf(ctx, path)
      const folder = namespace.folders.find((f) => f.name.toLowerCase() === (unc.rest[0] ?? '').toLowerCase())
      if (!folder)
        throw psError(
          `Impossible de trouver le dossier « ${path} ».`,
          'ObjectNotFound',
          'FolderNotFound',
          path
        )
      return folder.targets.map((t) => targetObject(path, t))
    }
  },
  {
    name: 'Remove-DfsnFolderTarget',
    module: 'DFSN',
    synopsis: 'Retire une cible d’un dossier d’espace de noms.',
    available,
    params: [
      { name: 'Path', type: 'string', mandatory: true, position: 0 },
      { name: 'TargetPath', type: 'string', mandatory: true, position: 1 },
      { name: 'Force', type: 'switch' }
    ],
    run(ctx, args) {
      if (!ctx.confirm(str(args['TargetPath']))) return
      ctx.apply(removeFolderTarget(ctx.state, str(args['Path']), str(args['TargetPath'])))
    }
  },
  {
    name: 'New-DfsReplicationGroup',
    module: 'DFSR',
    synopsis: 'Crée un groupe de réplication.',
    available,
    params: [{ name: 'GroupName', type: 'string', mandatory: true, position: 0 }],
    run(ctx, args) {
      ctx.apply(newReplicationGroup(ctx.state, ctx.deviceId, str(args['GroupName'])))
    }
  },
  {
    name: 'Get-DfsReplicationGroup',
    module: 'DFSR',
    synopsis: 'Liste les groupes de réplication.',
    available,
    params: [{ name: 'GroupName', type: 'string', position: 0 }],
    run(ctx, args) {
      const wanted = args['GroupName'] ? str(args['GroupName']).toLowerCase() : null
      return Object.values(ctx.state.devices).flatMap((d) =>
        d.kind === 'server'
          ? (dfsOf(d)?.groups ?? [])
              .filter((g) => !wanted || g.name.toLowerCase() === wanted)
              .map((g) =>
                psObject(
                  'DfsReplicationGroup',
                  { GroupName: g.name, DomainName: d.host.domain ?? '', State: 'Normal', Description: '' },
                  { kind: 'list', props: ['GroupName', 'DomainName', 'State', 'Description'] }
                )
              )
          : []
      )
    }
  },
  {
    name: 'Remove-DfsReplicationGroup',
    module: 'DFSR',
    synopsis: 'Supprime un groupe de réplication.',
    available,
    params: [
      { name: 'GroupName', type: 'string', mandatory: true, position: 0 },
      { name: 'RemoveReplicatedFolders', type: 'switch' },
      { name: 'Force', type: 'switch' }
    ],
    run(ctx, args) {
      if (!ctx.confirm(str(args['GroupName']))) return
      ctx.apply(removeReplicationGroup(ctx.state, str(args['GroupName'])))
    }
  },
  {
    name: 'Add-DfsrMember',
    module: 'DFSR',
    synopsis: 'Ajoute des serveurs à un groupe de réplication.',
    available,
    params: [
      { name: 'GroupName', type: 'string', mandatory: true, position: 0 },
      { name: 'ComputerName', type: 'string[]', mandatory: true, position: 1 }
    ],
    run(ctx, args) {
      const names = Array.isArray(args['ComputerName']) ? args['ComputerName'] : [args['ComputerName']]
      for (const n of names) ctx.apply(addReplicationMember(ctx.state, str(args['GroupName']), str(n)))
    }
  },
  {
    name: 'New-DfsReplicatedFolder',
    module: 'DFSR',
    synopsis: 'Crée un dossier répliqué dans un groupe.',
    available,
    params: [
      { name: 'GroupName', type: 'string', mandatory: true, position: 0 },
      { name: 'FolderName', type: 'string', mandatory: true, position: 1 }
    ],
    run(ctx, args) {
      ctx.apply(newReplicatedFolder(ctx.state, str(args['GroupName']), str(args['FolderName'])))
    }
  },
  {
    name: 'Set-DfsrMembership',
    module: 'DFSR',
    synopsis: 'Définit le chemin local d’un membre pour un dossier répliqué.',
    available,
    params: [
      { name: 'GroupName', type: 'string', mandatory: true },
      { name: 'FolderName', type: 'string', mandatory: true },
      { name: 'ComputerName', type: 'string', mandatory: true },
      { name: 'ContentPath', type: 'string', mandatory: true },
      { name: 'PrimaryMember', type: 'bool' },
      { name: 'Force', type: 'switch' }
    ],
    run(ctx, args) {
      ctx.apply(
        setMembership(ctx.state, str(args['GroupName']), str(args['FolderName']), str(args['ComputerName']), {
          contentPath: str(args['ContentPath']),
          primary: args['PrimaryMember'] === true
        })
      )
    }
  },
  {
    name: 'Get-DfsrMembership',
    module: 'DFSR',
    synopsis: 'Liste les appartenances des membres aux dossiers répliqués.',
    available,
    params: [{ name: 'GroupName', type: 'string', mandatory: true, position: 0 }],
    run(ctx, args) {
      const found = findGroup(ctx.state, str(args['GroupName']))
      if (!found)
        throw psError(
          `Le groupe de réplication « ${str(args['GroupName'])} » est introuvable.`,
          'ObjectNotFound',
          'GroupNotFound'
        )
      return found.group.folders.flatMap((f) =>
        Object.entries(f.paths).map(([id, path]) =>
          psObject(
            'DfsrMembership',
            {
              GroupName: found.group.name,
              ComputerName: ctx.state.devices[id]?.name ?? id,
              FolderName: f.name,
              ContentPath: path,
              PrimaryMember: f.primary === id
            },
            {
              kind: 'table',
              props: ['GroupName', 'ComputerName', 'FolderName', 'ContentPath', 'PrimaryMember']
            }
          )
        )
      )
    }
  },
  {
    name: 'Sync-DfsReplicationGroup',
    module: 'DFSR',
    synopsis: 'Force la réplication d’un groupe (ignore la planification).',
    available,
    params: [
      { name: 'GroupName', type: 'string', mandatory: true, position: 0 },
      { name: 'SourceComputerName', type: 'string' },
      { name: 'DestinationComputerName', type: 'string' },
      { name: 'DurationInMinutes', type: 'int' }
    ],
    run(ctx, args) {
      ctx.apply(syncReplicationGroup(ctx.state, str(args['GroupName'])))
    }
  }
]
