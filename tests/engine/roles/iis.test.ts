/**
 * Rôle IIS : sites, liaisons (IP, port, en-tête d'hôte), dossier racine, conflits, HTTPS
 * (certificat auto-signé non approuvé) et requêtes HTTP depuis un poste avec résolution DNS.
 */
import { describe, expect, it } from 'vitest'
import {
  command,
  dispatch,
  domainToken,
  evaluateCheck,
  httpGet,
  iisServerOf,
  installFeatures,
  unwrap,
  type AnyCommand,
  type LabState
} from '@engine/index'
import { buildReferenceLab } from '../serialization/reference-lab'
import { run } from '../shell/helpers'

const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''

function exec(state: LabState, ...cmds: AnyCommand[]): LabState {
  let s = state
  for (const cmd of cmds) {
    const r = dispatch(s, cmd)
    if (!r.ok) throw new Error(`${cmd.type} : ${r.error.message}`)
    s = r.state
  }
  return s
}

/** SRV1 avec IIS ; dossier C:\Sites\Intranet contenant index.html. */
function iisLab(): LabState {
  let s = buildReferenceLab()
  const srv = id(s, 'SRV1')
  s = unwrap(installFeatures(s, srv, ['Web-Server'], { includeManagementTools: true })).state
  const token = domainToken(s.domains['lab.local']!, 'Administrateur')!
  return exec(
    s,
    command('files.createItem', srv, 'C:\\Sites\\Intranet', 'folder', token, { parents: true }),
    command('files.createItem', srv, 'C:\\Sites\\Intranet\\index.html', 'file', token, {})
  )
}

const intranet = (s: LabState) =>
  exec(
    s,
    command('iis.addSite', id(s, 'SRV1'), {
      name: 'Intranet',
      physicalPath: 'C:\\Sites\\Intranet',
      binding: { host: 'intranet.lab.local' }
    })
  )

describe('rôle IIS', () => {
  it('installation : site par défaut sur *:80 et page d’accueil dans C:\\inetpub\\wwwroot', () => {
    const s = iisLab()
    const iis = iisServerOf(s.devices[id(s, 'SRV1')])!
    expect(iis.sites.map((x) => [x.name, x.state, x.physicalPath])).toEqual([
      ['Default Web Site', 'Started', 'C:\\inetpub\\wwwroot']
    ])
    const r = httpGet(s, id(s, 'PC1'), 'http://srv1.lab.local')
    expect(r.kind === 'response' && [r.status, r.file]).toEqual([200, 'C:\\inetpub\\wwwroot\\iisstart.htm'])
    expect(r.trace?.events.some((e) => e.protocol === 'HTTP')).toBe(true)
  })

  it('acceptation : http://intranet.lab.local répond depuis un client après ajout du CNAME', () => {
    let s = intranet(iisLab())
    const pc1 = id(s, 'PC1')
    const before = httpGet(s, pc1, 'http://intranet.lab.local')
    // Le lab de référence a déjà un CNAME intranet → srv1 : on le retire d'abord
    s = exec(
      s,
      command('dns.removeRecord', id(s, 'SRV1'), 'lab.local', 'intranet', 'CNAME', 'srv1.lab.local.')
    )
    const without = httpGet(s, pc1, 'http://intranet.lab.local')
    expect(without.kind === 'failure' && without.code).toBe('NameNotResolved')
    s = exec(
      s,
      command('dns.addRecord', id(s, 'SRV1'), 'lab.local', {
        name: 'intranet',
        type: 'CNAME',
        data: 'srv1.lab.local'
      })
    )
    const r = httpGet(s, pc1, 'http://intranet.lab.local/')
    expect(r.kind === 'response' && [r.status, r.site?.name, r.file]).toEqual([
      200,
      'Intranet',
      'C:\\Sites\\Intranet\\index.html'
    ])
    expect(before.kind).toBe('response')
  })

  it('en-tête d’hôte : le nom du serveur atteint le site par défaut, pas le site Intranet', () => {
    const s = intranet(iisLab())
    const r = httpGet(s, id(s, 'PC1'), 'http://srv1.lab.local')
    expect(r.kind === 'response' && r.site?.name).toBe('Default Web Site')
  })

  it('erreurs : 404, 403.14, site arrêté, port fermé, nom d’hôte inconnu', () => {
    let s = intranet(iisLab())
    const pc1 = id(s, 'PC1')
    const srv = id(s, 'SRV1')
    const missing = httpGet(s, pc1, 'http://intranet.lab.local/absent.html')
    expect(missing.kind === 'response' && [missing.status, missing.subStatus]).toEqual([404, 0])
    const token = domainToken(s.domains['lab.local']!, 'Administrateur')!
    s = exec(s, command('files.createItem', srv, 'C:\\Sites\\Intranet\\docs', 'folder', token, {}))
    const listing = httpGet(s, pc1, 'http://intranet.lab.local/docs')
    expect(listing.kind === 'response' && [listing.status, listing.subStatus]).toEqual([403, 14])
    // Port sans site
    const closed = httpGet(s, pc1, 'http://srv1.lab.local:8080')
    expect(closed.kind === 'failure' && closed.code).toBe('ConnectFailed')
    // Site par défaut arrêté : seul le site Intranet écoute sur 80, pour son seul nom
    s = exec(s, command('iis.setSiteState', srv, 'Default Web Site', false))
    const badHost = httpGet(s, pc1, 'http://srv1.lab.local')
    expect(badHost.kind === 'response' && badHost.status).toBe(400)
    s = exec(s, command('iis.setSiteState', srv, 'Intranet', false))
    const stopped = httpGet(s, pc1, 'http://intranet.lab.local')
    expect(stopped.kind === 'failure' && stopped.code).toBe('ConnectFailed')
  })

  it('liaison en conflit : site créé arrêté, démarrage refusé tant que l’autre site tourne', () => {
    let s = iisLab()
    const srv = id(s, 'SRV1')
    const created = dispatch(
      s,
      command('iis.addSite', srv, {
        name: 'Doublon',
        physicalPath: 'C:\\Sites\\Intranet',
        binding: { port: 80 }
      })
    )
    expect(created.ok && created.value).toEqual({ id: 2, started: false })
    s = created.ok ? created.state : s
    const start = dispatch(s, command('iis.setSiteState', srv, 'Doublon', true))
    expect(!start.ok && start.error.message).toMatch(/déjà utilisée par le site « Default Web Site »/)
    const same = dispatch(s, command('iis.addBinding', srv, 'Doublon', { port: 80 }))
    expect(!same.ok && same.error.code).toBe('BindingExists')
    const noFolder = dispatch(
      s,
      command('iis.addSite', srv, { name: 'X', physicalPath: 'C:\\Absent', binding: {} })
    )
    expect(!noFolder.ok && noFolder.error.code).toBe('PathNotFound')
    const badPort = dispatch(s, command('iis.addBinding', srv, 'Doublon', { port: 70000 }))
    expect(!badPort.ok && badPort.error.code).toBe('InvalidPort')
  })

  it('HTTPS : certificat requis, auto-signé non approuvé par le poste, approuvé une fois dans Root', () => {
    let s = intranet(iisLab())
    const srv = id(s, 'SRV1')
    const pc1 = id(s, 'PC1')
    s = exec(s, command('iis.addBinding', srv, 'Intranet', { protocol: 'https', host: 'intranet.lab.local' }))
    const noCert = httpGet(s, pc1, 'https://intranet.lab.local')
    expect(noCert.kind === 'failure' && noCert.code).toBe('SecureChannel')
    const r = dispatch(s, command('system.newSelfSignedCertificate', srv, ['intranet.lab.local']))
    if (!r.ok) throw new Error(r.error.message)
    s = exec(
      r.state,
      command(
        'iis.setBindingCertificate',
        srv,
        'Intranet',
        { ip: '*', port: 443, host: 'intranet.lab.local' },
        r.value
      )
    )
    const untrusted = httpGet(s, pc1, 'https://intranet.lab.local')
    expect(untrusted.kind === 'response' && untrusted.certificateWarning).toMatch(
      /autorité de certification approuvée/
    )
    // Nom non couvert par le certificat
    s = exec(s, command('iis.addBinding', srv, 'Intranet', { protocol: 'https', port: 8443 }))
    const cert = s.devices[srv]!.kind === 'server' ? s.devices[srv]!.host.certificates[0]! : null
    s = exec(
      s,
      command(
        'iis.setBindingCertificate',
        srv,
        'Intranet',
        { ip: '*', port: 8443, host: '' },
        cert!.thumbprint
      )
    )
    const wrongName = httpGet(s, pc1, 'https://srv1.lab.local:8443')
    expect(wrongName.kind === 'response' && wrongName.certificateWarning).toMatch(/autre nom/)
    // Le poste approuve le certificat (magasin Root) : plus d'avertissement
    const pc = s.devices[pc1]!
    const trusted: LabState = {
      ...s,
      devices: {
        ...s.devices,
        [pc1]:
          pc.kind === 'client'
            ? { ...pc, host: { ...pc.host, certificates: [{ ...cert!, store: 'Root' }] } }
            : pc
      }
    }
    const ok = httpGet(trusted, pc1, 'https://intranet.lab.local')
    expect(ok.kind === 'response' && ok.certificateWarning).toBe(null)
  })

  it('cmdlets WebAdministration et Invoke-WebRequest : même état que la console', () => {
    let s = iisLab()
    const srv = id(s, 'SRV1')
    const pc1 = id(s, 'PC1')
    s = run(
      s,
      srv,
      "New-Website -Name Intranet -PhysicalPath 'C:\\Sites\\Intranet' -Port 80 -HostHeader intranet.lab.local"
    ).state
    expect(iisServerOf(s.devices[srv])).toEqual(iisServerOf(intranet(iisLab()).devices[srv]))
    let r = run(s, srv, 'Get-Website')
    expect(r.text).toMatch(/Intranet\s+2\s+Started/)
    r = run(s, pc1, 'Invoke-WebRequest http://intranet.lab.local -UseBasicParsing')
    expect(r.errors).toBe('')
    expect(r.text).toMatch(/StatusCode\s+: 200/)
    expect(r.traceEvents).toBeGreaterThan(0)
    r = run(s, pc1, 'Invoke-WebRequest http://intranet.lab.local/absent.html')
    expect(r.errors).toMatch(/404\.0 - Not Found/)
    r = run(s, pc1, 'iwr http://inconnu.lab.local')
    expect(r.errors).toMatch(/Le nom distant n’a pas pu être résolu/)
    s = run(
      s,
      srv,
      'New-WebBinding -Name Intranet -Protocol https -Port 443 -HostHeader intranet.lab.local'
    ).state
    expect(run(s, srv, 'Get-WebBinding -Name Intranet').text).toContain('*:443:intranet.lab.local')
    s = run(s, srv, 'Stop-Website -Name Intranet').state
    expect(iisServerOf(s.devices[srv])!.sites[1]!.state).toBe('Stopped')
    s = run(
      s,
      srv,
      'Remove-WebBinding -Name Intranet -Protocol https -Port 443 -HostHeader intranet.lab.local'
    ).state
    s = run(s, srv, 'Remove-Website -Name Intranet').state
    expect(iisServerOf(s.devices[srv])!.sites).toHaveLength(1)
    const cert = run(
      s,
      srv,
      'New-SelfSignedCertificate -DnsName intranet.lab.local -CertStoreLocation Cert:\\LocalMachine\\My'
    )
    expect(cert.text).toContain('CN=intranet.lab.local')
    const badStore = run(s, srv, 'New-SelfSignedCertificate -DnsName x.lab.local')
    expect(badStore.errors).toMatch(/LocalMachine/)
  })

  it('critères de lab', () => {
    const s = intranet(iisLab())
    expect(
      evaluateCheck(s, {
        type: 'iisSite',
        server: 'SRV1',
        name: 'intranet',
        started: true,
        host: 'intranet.lab.local'
      })
    ).toBe(true)
    expect(
      evaluateCheck(s, { type: 'httpResponse', from: 'PC1', url: 'http://intranet.lab.local', status: 200 })
    ).toBe(true)
    expect(
      evaluateCheck(s, { type: 'httpResponse', from: 'PC1', url: 'http://intranet.lab.local/x', status: 200 })
    ).toBe(false)
  })
})
