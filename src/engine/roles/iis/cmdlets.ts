/**
 * Cmdlets du module WebAdministration (sites et liaisons IIS) et Invoke-WebRequest (client HTTP,
 * disponible sur tout ordinateur).
 */
import { psError } from '../../shell/ps/errors'
import type { CmdContext } from '../../shell/ps/interpreter'
import type { CmdletDef, ParamDef } from '../../shell/ps/registry'
import { psObject, psToString, type PsValue } from '../../shell/ps/values'
import { hasFeature } from '../../shell/ps/cmdlets/helpers'
import { TRUST_FAILURE, httpGet } from './http'
import type { IisSite } from './schema'
import { addBinding, addSite, removeBinding, removeSite, setSiteState } from './server'
import { bindingInformation, iisServerOf } from './state'

const MODULE = 'WebAdministration'
const available = (ctx: CmdContext) => hasFeature(ctx, 'Web-Server')
const str = (v: PsValue | undefined): string => psToString(v)
const num = (v: PsValue | undefined): number | undefined =>
  v === undefined || v === null ? undefined : Number(v)

function sitesOf(ctx: CmdContext): IisSite[] {
  return iisServerOf(ctx.device)?.sites ?? []
}

const siteNames = (ctx: CmdContext) => sitesOf(ctx).map((s) => s.name)
const nameParam: ParamDef = { name: 'Name', type: 'string', position: 0, complete: siteNames }

function siteObject(site: IisSite) {
  return psObject(
    'System.Object',
    {
      Name: site.name,
      ID: site.id,
      State: site.state,
      'Physical Path': site.physicalPath,
      Bindings: site.bindings.map((b) => `${b.protocol} ${bindingInformation(b)}`).join('\n')
    },
    { kind: 'table', props: ['Name', 'ID', 'State', 'Physical Path', 'Bindings'] }
  )
}

function siteParam(ctx: CmdContext, args: Record<string, PsValue>): string {
  const name = str(args['Name'])
  if (!sitesOf(ctx).some((s) => s.name.toLowerCase() === name.toLowerCase()))
    throw psError(
      `Impossible de trouver le site Web « ${name} ».`,
      'ObjectNotFound',
      'InvalidArgument,Microsoft.IIs.PowerShell.Provider.GetWebsiteCommand',
      name
    )
  return name
}

const protocolParam: ParamDef = { name: 'Protocol', type: 'string', validateSet: ['http', 'https'] }

function bindingArgs(args: Record<string, PsValue>) {
  const protocol = (args['Protocol'] ? str(args['Protocol']) : 'http') as 'http' | 'https'
  return {
    protocol,
    ip: args['IPAddress'] ? str(args['IPAddress']) : '*',
    port: num(args['Port']) ?? (protocol === 'https' ? 443 : 80),
    host: args['HostHeader'] ? str(args['HostHeader']) : ''
  }
}

export const iisCmdlets: CmdletDef[] = [
  {
    name: 'Get-Website',
    module: MODULE,
    synopsis: 'Liste les sites Web IIS.',
    available,
    params: [nameParam],
    run(ctx, args) {
      const name = args['Name'] ? str(args['Name']).toLowerCase() : null
      return sitesOf(ctx)
        .filter((s) => !name || s.name.toLowerCase() === name)
        .map(siteObject)
    }
  },
  {
    name: 'New-Website',
    module: MODULE,
    synopsis: 'Crée un site Web.',
    available,
    params: [
      { ...nameParam, mandatory: true },
      { name: 'Port', type: 'int' },
      { name: 'IPAddress', type: 'string' },
      { name: 'HostHeader', type: 'string' },
      { name: 'PhysicalPath', type: 'string' },
      { name: 'Ssl', type: 'switch' },
      { name: 'Id', type: 'int' },
      { name: 'Force', type: 'switch' }
    ],
    run(ctx, args) {
      const ssl = args['Ssl'] === true
      const name = str(args['Name'])
      const result = ctx.apply(
        addSite(ctx.state, ctx.deviceId, {
          name,
          physicalPath: args['PhysicalPath'] ? str(args['PhysicalPath']) : `C:\\inetpub\\${name}`,
          binding: { ...bindingArgs({ ...args, Protocol: ssl ? 'https' : 'http' }) }
        })
      )
      if (!result.started)
        ctx.warn(
          `Le site « ${name} » a été créé mais n’a pas démarré : sa liaison est déjà utilisée par un autre site.`
        )
      const site = sitesOf(ctx).find((s) => s.id === result.id)
      return site ? [siteObject(site)] : []
    }
  },
  {
    name: 'Remove-Website',
    module: MODULE,
    synopsis: 'Supprime un site Web.',
    available,
    params: [{ ...nameParam, mandatory: true }],
    run(ctx, args) {
      ctx.apply(removeSite(ctx.state, ctx.deviceId, siteParam(ctx, args)))
    }
  },
  {
    name: 'Start-Website',
    module: MODULE,
    synopsis: 'Démarre un site Web.',
    available,
    params: [{ ...nameParam, mandatory: true }],
    run(ctx, args) {
      ctx.apply(setSiteState(ctx.state, ctx.deviceId, siteParam(ctx, args), true))
    }
  },
  {
    name: 'Stop-Website',
    module: MODULE,
    synopsis: 'Arrête un site Web.',
    available,
    params: [{ ...nameParam, mandatory: true }],
    run(ctx, args) {
      ctx.apply(setSiteState(ctx.state, ctx.deviceId, siteParam(ctx, args), false))
    }
  },
  {
    name: 'Get-WebBinding',
    module: MODULE,
    synopsis: 'Liste les liaisons des sites.',
    available,
    params: [nameParam, protocolParam, { name: 'Port', type: 'int' }],
    run(ctx, args) {
      const name = args['Name'] ? str(args['Name']).toLowerCase() : null
      return sitesOf(ctx)
        .filter((s) => !name || s.name.toLowerCase() === name)
        .flatMap((s) => s.bindings)
        .filter(
          (b) =>
            (!args['Protocol'] || b.protocol === str(args['Protocol'])) &&
            (!args['Port'] || b.port === num(args['Port']))
        )
        .map((b) =>
          psObject(
            'Microsoft.IIs.PowerShell.Framework.ConfigurationElement',
            { protocol: b.protocol, bindingInformation: bindingInformation(b), sslFlags: 0 },
            { kind: 'table', props: ['protocol', 'bindingInformation', 'sslFlags'] }
          )
        )
    }
  },
  {
    name: 'New-WebBinding',
    module: MODULE,
    synopsis: 'Ajoute une liaison à un site.',
    available,
    params: [
      { ...nameParam, mandatory: true },
      protocolParam,
      { name: 'Port', type: 'int' },
      { name: 'IPAddress', type: 'string' },
      { name: 'HostHeader', type: 'string' },
      { name: 'SslFlags', type: 'int' }
    ],
    run(ctx, args) {
      const name = siteParam(ctx, args)
      const result = ctx.apply(addBinding(ctx.state, ctx.deviceId, name, bindingArgs(args)))
      if (result.conflict)
        ctx.warn(
          `Cette liaison est déjà utilisée par le site « ${result.conflict} » : un seul des deux sites peut démarrer.`
        )
    }
  },
  {
    name: 'Remove-WebBinding',
    module: MODULE,
    synopsis: 'Supprime une liaison d’un site.',
    available,
    params: [
      { ...nameParam, mandatory: true },
      protocolParam,
      { name: 'Port', type: 'int' },
      { name: 'IPAddress', type: 'string' },
      { name: 'HostHeader', type: 'string' }
    ],
    run(ctx, args) {
      ctx.apply(removeBinding(ctx.state, ctx.deviceId, siteParam(ctx, args), bindingArgs(args)))
    }
  },
  {
    name: 'Invoke-WebRequest',
    aliases: ['iwr', 'curl', 'wget'],
    module: 'Microsoft.PowerShell.Utility',
    synopsis: 'Envoie une requête HTTP ou HTTPS à un site Web.',
    params: [
      { name: 'Uri', type: 'string', position: 0, mandatory: true },
      { name: 'UseBasicParsing', type: 'switch' },
      { name: 'Method', type: 'string', validateSet: ['Get', 'Head'] }
    ],
    run(ctx, args) {
      const r = httpGet(ctx.state, ctx.deviceId, str(args['Uri']))
      if (r.trace) ctx.addTrace(r.trace)
      const fail = (message: string, id: string) =>
        psError(
          message,
          'InvalidOperation',
          `${id},Microsoft.PowerShell.Commands.InvokeWebRequestCommand`,
          str(args['Uri'])
        )
      if (r.kind === 'failure')
        throw fail(
          r.message,
          r.code === 'InvalidUrl' ? 'System.UriFormatException' : 'WebCmdletWebResponseException'
        )
      if (r.certificateWarning) throw fail(TRUST_FAILURE, 'WebCmdletWebResponseException')
      if (r.status !== 200) throw fail(r.body, 'WebCmdletWebResponseException')
      return [
        psObject(
          'Microsoft.PowerShell.Commands.HtmlWebResponseObject',
          {
            StatusCode: r.status,
            StatusDescription: r.statusText,
            Content: r.body,
            RawContentLength: r.body.length,
            Server: r.server.name
          },
          { kind: 'list', props: ['StatusCode', 'StatusDescription', 'Content', 'RawContentLength'] }
        )
      ]
    }
  }
]
