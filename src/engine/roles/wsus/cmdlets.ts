/**
 * Cmdlets du module UpdateServices (outils API et PowerShell de WSUS).
 * La création des groupes et la synchronisation se font dans la console Update Services.
 */
import type { ServerDevice } from '../../model/schema'
import { psError } from '../../shell/ps/errors'
import type { CmdContext } from '../../shell/ps/interpreter'
import type { CmdletDef } from '../../shell/ps/registry'
import { flatten, isPsObject, psObject, psToString, type PsObject, type PsValue } from '../../shell/ps/values'
import { hasFeature } from '../../shell/ps/cmdlets/helpers'
import { CLASSIFICATION_LABELS, catalogUpdate, type CatalogUpdate } from './catalog'
import { WSUS_HTTP_PORT, wsusComputers, type WsusComputer } from './client'
import { WSUS_CLASSIFICATIONS, type WsusClassification, type WsusServer } from './schema'
import {
  approveWsusUpdate,
  approvedGroups,
  assignWsusComputer,
  declineWsusUpdate,
  setWsusClassification
} from './server'
import { wsusGroups, wsusServerOf } from './state'

const MODULE = 'UpdateServices'
const available = (ctx: CmdContext) => hasFeature(ctx, 'UpdateServices-API')
const str = (v: PsValue | undefined): string => psToString(v)

/** Serveur WSUS local, post-installation terminée. */
function wsusOf(ctx: CmdContext): { server: ServerDevice; wsus: WsusServer } {
  const d = ctx.device
  const wsus = wsusServerOf(d)
  if (d.kind !== 'server' || !d.host.features.includes('UpdateServices') || !wsus?.configured)
    throw psError(
      `Impossible de se connecter au serveur WSUS ${d.name} sur le port ${WSUS_HTTP_PORT} : le service n’est pas installé ou les tâches de post-installation ne sont pas terminées.`,
      'ObjectNotFound',
      'ServerNotFound,Microsoft.UpdateServices.Commands.GetWsusServerCommand',
      d.name
    )
  return { server: d, wsus }
}

function updateObject(wsus: WsusServer, u: CatalogUpdate): PsObject {
  const groups = approvedGroups(wsus, u.id)
  const approved = wsus.declined.includes(u.id) ? 'Declined' : groups.length > 0 ? 'Install' : 'NotApproved'
  return {
    ...psObject(
      'Microsoft.UpdateServices.Commands.WsusUpdate',
      {
        Title: u.title,
        Classification: CLASSIFICATION_LABELS[u.classification],
        Approved: approved,
        UpdateId: u.id,
        ApprovedGroups: groups
      },
      { kind: 'table', props: ['Title', 'Classification', 'Approved'] }
    ),
    text: u.title
  }
}

/** Identifiants des mises à jour passées par -Update ou par le pipeline (objets ou KB). */
function updateIds(args: Record<string, PsValue>, input: PsValue[]): string[] {
  const values = flatten([...(args['Update'] !== undefined ? [args['Update']] : []), ...input])
  return values.map((v) => (isPsObject(v) ? str(v.props['UpdateId']) : str(v)))
}

function classificationObject(wsus: WsusServer, c: WsusClassification): PsObject {
  return psObject(
    'Microsoft.UpdateServices.Commands.WsusClassification',
    {
      Classification: {
        ...psObject('UpdateClassification', { Title: CLASSIFICATION_LABELS[c], Id: c }),
        text: CLASSIFICATION_LABELS[c]
      },
      Enabled: wsus.classifications.includes(c)
    },
    { kind: 'table', props: ['Classification', 'Enabled'] }
  )
}

function computerObject(c: WsusComputer): PsObject {
  return {
    ...psObject(
      'Microsoft.UpdateServices.Commands.WsusComputer',
      {
        FullDomainName: c.name,
        IPAddress: c.ip,
        OperatingSystem: c.kind === 'server' ? 'Système serveur' : 'Système client',
        ComputerTargetGroup: c.group,
        DeviceId: c.deviceId
      },
      { kind: 'table', props: ['FullDomainName', 'IPAddress', 'OperatingSystem', 'ComputerTargetGroup'] }
    ),
    text: c.name
  }
}

export const wsusCmdlets: CmdletDef[] = [
  {
    name: 'Get-WsusServer',
    module: MODULE,
    synopsis: 'Obtient le serveur WSUS.',
    available,
    params: [
      { name: 'Name', type: 'string', position: 0 },
      { name: 'PortNumber', type: 'int', position: 1 },
      { name: 'UseSsl', type: 'switch' }
    ],
    run(ctx) {
      const { server } = wsusOf(ctx)
      return [
        psObject(
          'Microsoft.UpdateServices.Internal.BaseApi.UpdateServer',
          { Name: server.name, PortNumber: WSUS_HTTP_PORT, UseSecureConnection: false },
          { kind: 'list', props: ['Name', 'PortNumber', 'UseSecureConnection'] }
        )
      ]
    }
  },
  {
    name: 'Get-WsusClassification',
    module: MODULE,
    synopsis: 'Liste les classifications des mises à jour et leur synchronisation.',
    available,
    params: [],
    run(ctx) {
      const { wsus } = wsusOf(ctx)
      return WSUS_CLASSIFICATIONS.map((c) => classificationObject(wsus, c))
    }
  },
  {
    name: 'Set-WsusClassification',
    module: MODULE,
    synopsis: 'Active ou désactive la synchronisation de classifications (entrée du pipeline).',
    available,
    params: [
      { name: 'Classification', type: 'any', pipeline: true, mandatory: true },
      { name: 'Disable', type: 'switch' }
    ],
    run(ctx, args, input) {
      wsusOf(ctx)
      const given = args['Classification']
      const values = flatten([...(given !== undefined ? [given] : []), ...input])
      for (const v of values) {
        const inner = (isPsObject(v) ? v.props['Classification'] : v) ?? null
        const key = isPsObject(inner) ? str(inner.props['Id']) : str(inner)
        const c = WSUS_CLASSIFICATIONS.find(
          (x) => x === key.toLowerCase() || CLASSIFICATION_LABELS[x].toLowerCase() === key.toLowerCase()
        )
        if (!c)
          throw psError(
            `La classification « ${key} » est introuvable.`,
            'ObjectNotFound',
            'ClassificationNotFound',
            key
          )
        ctx.apply(setWsusClassification(ctx.state, ctx.deviceId, c, args['Disable'] !== true))
      }
    }
  },
  {
    name: 'Get-WsusUpdate',
    module: MODULE,
    synopsis: 'Liste les mises à jour synchronisées.',
    available,
    params: [
      { name: 'UpdateId', type: 'string' },
      {
        name: 'Approval',
        type: 'string',
        validateSet: ['AnyExceptDeclined', 'Approved', 'Unapproved', 'Declined']
      },
      { name: 'Classification', type: 'string', validateSet: ['All', 'Critical', 'Security', 'WSUS'] },
      { name: 'Status', type: 'string' }
    ],
    run(ctx, args) {
      const { wsus } = wsusOf(ctx)
      const approval = args['Approval'] ? str(args['Approval']) : 'AnyExceptDeclined'
      const classification = args['Classification'] ? str(args['Classification']) : 'All'
      const id = args['UpdateId'] ? (catalogUpdate(str(args['UpdateId']))?.id ?? str(args['UpdateId'])) : null
      const updates = wsus.updates.flatMap((u) => {
        const update = catalogUpdate(u)
        return update ? [update] : []
      })
      const selected = updates.filter((u) => {
        if (id && u.id !== id) return false
        const declined = wsus.declined.includes(u.id)
        const approved = approvedGroups(wsus, u.id).length > 0
        if (approval === 'AnyExceptDeclined' && declined) return false
        if (approval === 'Approved' && !approved) return false
        if (approval === 'Unapproved' && (approved || declined)) return false
        if (approval === 'Declined' && !declined) return false
        if (classification === 'Critical') return u.classification === 'critical'
        if (classification === 'Security') return u.classification === 'security'
        if (classification === 'WSUS') return false
        return true
      })
      if (id && selected.length === 0)
        throw psError(
          `La mise à jour « ${id} » est introuvable sur le serveur WSUS.`,
          'ObjectNotFound',
          'UpdateNotFound',
          id
        )
      return selected.map((u) => updateObject(wsus, u))
    }
  },
  {
    name: 'Approve-WsusUpdate',
    module: MODULE,
    synopsis: 'Approuve des mises à jour pour un groupe d’ordinateurs.',
    available,
    params: [
      { name: 'Update', type: 'any', pipeline: true, mandatory: true },
      { name: 'Action', type: 'string', mandatory: true, validateSet: ['Install', 'NotApproved'] },
      {
        name: 'TargetGroupName',
        type: 'string',
        mandatory: true,
        complete: (ctx) => {
          const wsus = wsusServerOf(ctx.device)
          return wsus ? wsusGroups(wsus) : []
        }
      }
    ],
    run(ctx, args, input) {
      wsusOf(ctx)
      for (const id of updateIds(args, input))
        ctx.apply(
          approveWsusUpdate(
            ctx.state,
            ctx.deviceId,
            id,
            str(args['TargetGroupName']),
            args['Action'] === 'Install'
          )
        )
    }
  },
  {
    name: 'Deny-WsusUpdate',
    module: MODULE,
    synopsis: 'Refuse des mises à jour.',
    available,
    params: [{ name: 'Update', type: 'any', pipeline: true, mandatory: true }],
    run(ctx, args, input) {
      wsusOf(ctx)
      for (const id of updateIds(args, input)) ctx.apply(declineWsusUpdate(ctx.state, ctx.deviceId, id, true))
    }
  },
  {
    name: 'Get-WsusComputer',
    module: MODULE,
    synopsis: 'Liste les ordinateurs clients du serveur WSUS.',
    available,
    params: [
      { name: 'NameIncludes', type: 'string' },
      { name: 'ComputerTargetGroups', type: 'string[]' },
      { name: 'All', type: 'switch' }
    ],
    run(ctx, args) {
      const { server } = wsusOf(ctx)
      const includes = args['NameIncludes'] ? str(args['NameIncludes']).toLowerCase() : null
      const groups = args['ComputerTargetGroups']
        ? flatten([args['ComputerTargetGroups']]).map((g) => str(g).toLowerCase())
        : null
      const list = wsusComputers(ctx.state, server.id).filter(
        (c) => (!includes || c.name.includes(includes)) && (!groups || groups.includes(c.group.toLowerCase()))
      )
      if (list.length === 0) {
        ctx.write('Aucun ordinateur disponible.')
        return []
      }
      return list.map(computerObject)
    }
  },
  {
    name: 'Add-WsusComputer',
    module: MODULE,
    synopsis: 'Place des ordinateurs dans un groupe (ciblage côté serveur).',
    available,
    params: [
      { name: 'Computer', type: 'any', pipeline: true, mandatory: true },
      { name: 'TargetGroupName', type: 'string', mandatory: true }
    ],
    run(ctx, args, input) {
      const { server } = wsusOf(ctx)
      const computers = wsusComputers(ctx.state, server.id)
      const values = flatten([...(args['Computer'] !== undefined ? [args['Computer']] : []), ...input])
      for (const v of values) {
        const name = isPsObject(v) ? str(v.props['FullDomainName']) : str(v)
        const lower = name.toLowerCase()
        const computer = computers.find((c) => c.name === lower || c.name.split('.')[0] === lower)
        if (!computer)
          throw psError(
            `L’ordinateur « ${name} » est introuvable sur le serveur WSUS.`,
            'ObjectNotFound',
            'ComputerNotFound',
            name
          )
        ctx.apply(
          assignWsusComputer(ctx.state, ctx.deviceId, computer.deviceId, str(args['TargetGroupName']))
        )
      }
    }
  }
]
