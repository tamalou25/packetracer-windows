/**
 * nslookup : interrogation d'un serveur DNS (sortie au format console FR).
 */
import { normalizeName } from './server'
import { dnsServersOf, resolveName, reverseLookup, type Resolution } from './resolver'
import type { ExecContext } from '../../shell/context'
import type { ToolDef } from '../../shell/tools/types'

const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/

/** Nom du serveur DNS par résolution inverse (« UnKnown » sans zone inverse). */
function serverName(ctx: ExecContext, server: string): string {
  if (server === '127.0.0.1') return 'localhost'
  const r = reverseLookup(ctx.state, ctx.deviceId, server, server)
  ctx.addTrace(r.trace)
  if (r.result.kind !== 'answer') return 'UnKnown'
  const ptr = r.result.records.find((x) => x.type === 'PTR')
  return ptr ? normalizeName(ptr.data) : 'UnKnown'
}

function timeoutLines(): string[] {
  return ['DNS request timed out.', '    timeout was 2 seconds.']
}

export const nslookupTool: ToolDef = {
  name: 'nslookup',
  synopsis: 'Interroge un serveur DNS.',
  run(ctx, args) {
    const target = args.find((a) => !a.startsWith('-'))
    const serverArg = args.filter((a) => !a.startsWith('-'))[1]
    const typeArg = args.find(
      (a) => a.toLowerCase().startsWith('-type=') || a.toLowerCase().startsWith('-q=')
    )
    const qtype = (typeArg?.split('=')[1]?.toUpperCase() ?? 'A') as
      'A' | 'PTR' | 'CNAME' | 'NS' | 'SOA' | 'SRV'
    if (!target) {
      ctx.writeLines([
        'Le mode interactif de nslookup n’est pas simulé.',
        'Utilisation : nslookup [-type=A|PTR|CNAME|NS|SOA|SRV] nom [serveur]',
        ''
      ])
      return
    }
    const servers = serverArg ? [serverArg] : dnsServersOf(ctx.host)
    const server = servers[0]
    if (!server) {
      ctx.writeLines([
        '*** Les serveurs par défaut ne sont pas disponibles',
        'Serveur :   UnKnown',
        'Address:  127.0.0.1',
        ''
      ])
      ctx.write(`*** UnKnown ne parvient pas à trouver ${target} : No response from server`, 'error')
      return
    }

    const nameOfServer = serverName(ctx, server)
    const resolution: Resolution = IP_RE.test(target)
      ? reverseLookup(ctx.state, ctx.deviceId, target, serverArg)
      : resolveName(ctx.state, ctx.deviceId, target, qtype, serverArg)
    ctx.addTrace(resolution.trace)
    const result = resolution.result

    if (result.kind === 'timeout') {
      ctx.writeLines([
        ...timeoutLines(),
        `Serveur :   ${nameOfServer}`,
        `Address:  ${server}`,
        '',
        ...timeoutLines()
      ])
      ctx.write(`*** Le délai d’attente de la requête sur ${nameOfServer} a expiré`, 'error')
      return
    }
    ctx.writeLines([`Serveur :   ${nameOfServer}`, `Address:  ${resolution.server ?? server}`, ''])
    if (result.kind === 'nxdomain') {
      ctx.write(`*** ${nameOfServer} ne parvient pas à trouver ${target} : Non-existent domain`, 'error')
      return
    }
    if (result.kind === 'servfail') {
      ctx.write(`*** ${nameOfServer} ne parvient pas à trouver ${target} : Server failed`, 'error')
      return
    }
    if (!result.authoritative) ctx.write('Réponse ne faisant pas autorité :')
    if (IP_RE.test(target)) {
      const ptr = result.records.find((r) => r.type === 'PTR')
      ctx.writeLines([`Nom :    ${normalizeName(ptr?.data ?? '')}`, `Address:  ${target}`, ''])
      return
    }
    const aliases = result.records.filter((r) => r.type === 'CNAME').map((r) => r.name)
    const finalRecords = result.records.filter((r) => r.type !== 'CNAME')
    const lastAlias = result.records.filter((r) => r.type === 'CNAME').at(-1)
    const finalName = lastAlias ? normalizeName(lastAlias.data) : resolution.fqdn
    if (qtype === 'A') {
      const addresses = finalRecords.filter((r) => r.type === 'A').map((r) => r.data)
      ctx.write(`Nom :    ${finalName}`)
      if (addresses.length === 1) ctx.write(`Address:  ${addresses[0]}`)
      else if (addresses.length > 1)
        ctx.writeLines([`Addresses:  ${addresses[0]}`, ...addresses.slice(1).map((a) => `          ${a}`)])
      if (aliases.length > 0) ctx.write(`Aliases:  ${aliases.join('\n          ')}`)
    } else {
      for (const r of result.records)
        ctx.write(`${r.name}\t${r.type === 'CNAME' ? 'canonical name' : r.type} = ${normalizeName(r.data)}`)
    }
    ctx.write('')
  }
}
