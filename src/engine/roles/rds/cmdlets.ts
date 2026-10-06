/**
 * Cmdlets du module RemoteDesktop (collections, RemoteApp, sessions) et gestion du groupe local
 * Utilisateurs du Bureau à distance (Add/Remove/Get-LocalGroupMember).
 */
import { findPrincipal } from '../adds/directory'
import { psError } from '../../shell/ps/errors'
import type { CmdContext } from '../../shell/ps/interpreter'
import type { CmdletDef, ParamDef } from '../../shell/ps/registry'
import { flatten, psObject, psToString, type PsValue } from '../../shell/ps/values'
import { hasFeature } from '../../shell/ps/cmdlets/helpers'
import {
  addRemoteApp,
  addSessionCollection,
  removeRemoteApp,
  removeSessionCollection,
  setCollectionUserGroups,
  setRemoteDesktop
} from './server'
import { rdsServerOf } from './state'

const MODULE = 'RemoteDesktop'
const available = (ctx: CmdContext) => hasFeature(ctx, 'RDS-RD-Server')
const str = (v: PsValue | undefined): string => psToString(v)
const list = (v: PsValue | undefined): string[] =>
  v === undefined ? [] : flatten([v]).map((x) => psToString(x))

const collectionNames = (ctx: CmdContext) => rdsServerOf(ctx.device)?.collections.map((c) => c.name) ?? []
const collectionParam: ParamDef = {
  name: 'CollectionName',
  type: 'string',
  mandatory: true,
  position: 0,
  complete: collectionNames
}
const brokerParams: ParamDef[] = [
  { name: 'ConnectionBroker', type: 'string' },
  { name: 'Force', type: 'switch' }
]

/** Groupe local géré : « Utilisateurs du Bureau à distance » (nom anglais accepté). */
const RDU = 'Utilisateurs du Bureau à distance'
function requireRduGroup(name: string): void {
  const n = name.trim().toLowerCase()
  if (n !== RDU.toLowerCase() && n !== 'remote desktop users')
    throw psError(
      `Le groupe « ${name} » n’est pas géré par le simulateur : seul le groupe « ${RDU} » l’est.`,
      'ObjectNotFound',
      'GroupNotFound,Microsoft.PowerShell.Commands.AddLocalGroupMemberCommand',
      name
    )
}

function hostUsers(ctx: CmdContext): string[] {
  const d = ctx.device
  return d.kind === 'server' || d.kind === 'client' ? d.host.remoteDesktop.users : []
}

const groupParams: ParamDef[] = [
  { name: 'Group', type: 'string', mandatory: true, position: 0, aliases: ['Name'] },
  { name: 'Member', type: 'string[]', mandatory: true, position: 1 }
]

export const rdsCmdlets: CmdletDef[] = [
  {
    name: 'New-RDSessionCollection',
    module: MODULE,
    synopsis: 'Crée une collection de sessions.',
    available,
    params: [
      collectionParam,
      { name: 'SessionHost', type: 'string[]' },
      { name: 'CollectionDescription', type: 'string' },
      ...brokerParams
    ],
    run(ctx, args) {
      const hosts = list(args['SessionHost']).map((h) => h.split('.')[0]!.toLowerCase())
      if (hosts.some((h) => h !== ctx.device.name.toLowerCase()))
        throw psError(
          'Déploiement à serveur unique : l’hôte de session doit être ce serveur.',
          'InvalidArgument',
          'SessionHost'
        )
      ctx.apply(
        addSessionCollection(ctx.state, ctx.deviceId, {
          name: str(args['CollectionName']),
          description: args['CollectionDescription'] ? str(args['CollectionDescription']) : '',
          userGroups: []
        })
      )
    }
  },
  {
    name: 'Get-RDSessionCollection',
    module: MODULE,
    synopsis: 'Liste les collections de sessions.',
    available,
    params: [{ ...collectionParam, mandatory: false }, ...brokerParams],
    run(ctx, args) {
      const name = args['CollectionName'] ? str(args['CollectionName']).toLowerCase() : null
      return (rdsServerOf(ctx.device)?.collections ?? [])
        .filter((c) => !name || c.name.toLowerCase() === name)
        .map((c) =>
          psObject(
            'Microsoft.RemoteDesktopServices.Management.RDSessionCollection',
            {
              CollectionName: c.name,
              Size: 1,
              ResourceType: c.remoteApps.length > 0 ? 'Programmes RemoteApp' : 'Bureau à distance',
              CollectionDescription: c.description,
              UserGroup: c.userGroups
            },
            { kind: 'table', props: ['CollectionName', 'Size', 'ResourceType', 'CollectionDescription'] }
          )
        )
    }
  },
  {
    name: 'Set-RDSessionCollectionConfiguration',
    module: MODULE,
    synopsis: 'Modifie la configuration d’une collection (groupes d’utilisateurs).',
    available,
    params: [collectionParam, { name: 'UserGroup', type: 'string[]' }, ...brokerParams],
    run(ctx, args) {
      if (args['UserGroup'] !== undefined)
        ctx.apply(
          setCollectionUserGroups(
            ctx.state,
            ctx.deviceId,
            str(args['CollectionName']),
            list(args['UserGroup'])
          )
        )
    }
  },
  {
    name: 'Remove-RDSessionCollection',
    module: MODULE,
    synopsis: 'Supprime une collection de sessions.',
    available,
    params: [collectionParam, ...brokerParams],
    run(ctx, args) {
      const name = str(args['CollectionName'])
      if (!ctx.confirm(name)) return
      ctx.apply(removeSessionCollection(ctx.state, ctx.deviceId, name))
    }
  },
  {
    name: 'New-RDRemoteApp',
    module: MODULE,
    synopsis: 'Publie un programme RemoteApp.',
    available,
    params: [
      collectionParam,
      { name: 'DisplayName', type: 'string', mandatory: true },
      { name: 'FilePath', type: 'string', mandatory: true },
      { name: 'Alias', type: 'string' },
      ...brokerParams
    ],
    run(ctx, args) {
      ctx.apply(
        addRemoteApp(ctx.state, ctx.deviceId, str(args['CollectionName']), {
          displayName: str(args['DisplayName']),
          filePath: str(args['FilePath']),
          ...(args['Alias'] ? { alias: str(args['Alias']) } : {})
        })
      )
    }
  },
  {
    name: 'Get-RDRemoteApp',
    module: MODULE,
    synopsis: 'Liste les programmes RemoteApp publiés.',
    available,
    params: [{ ...collectionParam, mandatory: false }, ...brokerParams],
    run(ctx, args) {
      const name = args['CollectionName'] ? str(args['CollectionName']).toLowerCase() : null
      return (rdsServerOf(ctx.device)?.collections ?? [])
        .filter((c) => !name || c.name.toLowerCase() === name)
        .flatMap((c) =>
          c.remoteApps.map((a) =>
            psObject(
              'Microsoft.RemoteDesktopServices.Management.RemoteApp',
              {
                CollectionName: c.name,
                Alias: a.alias,
                DisplayName: a.displayName,
                FolderName: '',
                FilePath: a.filePath
              },
              { kind: 'table', props: ['CollectionName', 'Alias', 'DisplayName', 'FilePath'] }
            )
          )
        )
    }
  },
  {
    name: 'Remove-RDRemoteApp',
    module: MODULE,
    synopsis: 'Retire un programme RemoteApp.',
    available,
    params: [collectionParam, { name: 'Alias', type: 'string', mandatory: true }, ...brokerParams],
    run(ctx, args) {
      ctx.apply(removeRemoteApp(ctx.state, ctx.deviceId, str(args['CollectionName']), str(args['Alias'])))
    }
  },
  {
    name: 'Get-RDUserSession',
    module: MODULE,
    synopsis: 'Liste les sessions Bureau à distance ouvertes.',
    available,
    params: brokerParams,
    run(ctx) {
      const d = ctx.device
      const sessions = d.kind === 'server' ? d.host.remoteSessions : []
      return sessions.map((s) =>
        psObject(
          'Microsoft.RemoteDesktopServices.Management.RDUserSession',
          {
            UserName: s.account.split('\\')[1] ?? s.account,
            DomainName: s.account.split('\\')[0] ?? '',
            SessionId: s.id,
            HostServer: d.name,
            ClientName: s.from,
            SessionState: 'STATE_ACTIVE',
            ApplicationType: s.app ?? 'Bureau'
          },
          {
            kind: 'table',
            props: ['UserName', 'DomainName', 'SessionId', 'ClientName', 'SessionState', 'ApplicationType']
          }
        )
      )
    }
  },
  {
    name: 'Add-LocalGroupMember',
    module: 'Microsoft.PowerShell.LocalAccounts',
    synopsis: 'Ajoute des membres à un groupe local.',
    params: groupParams,
    run(ctx, args) {
      requireRduGroup(str(args['Group']))
      ctx.apply(
        setRemoteDesktop(ctx.state, ctx.deviceId, { users: [...hostUsers(ctx), ...list(args['Member'])] })
      )
    }
  },
  {
    name: 'Remove-LocalGroupMember',
    module: 'Microsoft.PowerShell.LocalAccounts',
    synopsis: 'Retire des membres d’un groupe local.',
    params: groupParams,
    run(ctx, args) {
      requireRduGroup(str(args['Group']))
      const removed = list(args['Member']).map((m) => m.toLowerCase())
      const keep = hostUsers(ctx).filter(
        (u) => !removed.includes(u.toLowerCase()) && !removed.includes((u.split('\\')[1] ?? '').toLowerCase())
      )
      ctx.apply(setRemoteDesktop(ctx.state, ctx.deviceId, { users: keep }))
    }
  },
  {
    name: 'Get-LocalGroupMember',
    module: 'Microsoft.PowerShell.LocalAccounts',
    synopsis: 'Liste les membres d’un groupe local.',
    params: [groupParams[0]!],
    run(ctx, args) {
      requireRduGroup(str(args['Group']))
      const d = ctx.device
      const domain =
        (d.kind === 'server' || d.kind === 'client') && d.host.domain
          ? ctx.state.domains[d.host.domain]
          : undefined
      return hostUsers(ctx).map((u) =>
        psObject(
          'Microsoft.PowerShell.Commands.LocalPrincipal',
          {
            ObjectClass: domain && findPrincipal(domain, u)?.kind === 'group' ? 'Groupe' : 'Utilisateur',
            Name: u,
            PrincipalSource: 'ActiveDirectory'
          },
          { kind: 'table', props: ['ObjectClass', 'Name', 'PrincipalSource'] }
        )
      )
    }
  }
]
