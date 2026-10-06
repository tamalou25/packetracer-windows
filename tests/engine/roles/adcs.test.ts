/**
 * AD CS : autorité racine d'entreprise, modèles, émission et révocation ; certificat racine
 * distribué aux membres du domaine par la stratégie ordinateur ; inscription automatique ;
 * certificat IIS émis par l'AC interne et approuvé par les postes du domaine.
 */
import { describe, expect, it } from 'vitest'
import {
  adcsOf,
  command,
  dispatch,
  evaluateCheck,
  httpGet,
  installFeatures,
  unwrap,
  type AnyCommand,
  type HostDevice,
  type LabState
} from '@engine/index'
import { buildReferenceLab } from '../serialization/reference-lab'
import { run } from '../shell/helpers'

const D = 'lab.local'
const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''
const host = (s: LabState, name: string) => s.devices[id(s, name)] as HostDevice

function exec(state: LabState, ...cmds: AnyCommand[]): LabState {
  let s = state
  for (const cmd of cmds) {
    const r = dispatch(s, cmd)
    if (!r.ok) throw new Error(`${cmd.type} : ${r.error.message}`)
    s = r.state
  }
  return s
}

const gpupdate = (s: LabState, name: string) => run(s, id(s, name), 'gpupdate /force', { shell: 'cmd' }).state
const roots = (s: LabState, name: string) => host(s, name).host.certificates.filter((c) => c.store === 'Root')

/** SRV1 (DC) : autorité racine d'entreprise et IIS. */
function caLab(): LabState {
  let s = buildReferenceLab()
  const srv = id(s, 'SRV1')
  s = unwrap(
    installFeatures(s, srv, ['ADCS-Cert-Authority', 'Web-Server'], { includeManagementTools: true })
  ).state
  return exec(s, command('adcs.install', srv, {}))
}

/** Certificat de domaine intranet.lab.local lié en HTTPS au site par défaut. */
function withHttps(state: LabState): { state: LabState; thumbprint: string } {
  const srv = id(state, 'SRV1')
  const r = dispatch(
    state,
    command('adcs.request', srv, { template: 'WebServer', dnsNames: ['intranet.lab.local'] })
  )
  if (!r.ok) throw new Error(r.error.message)
  const s = exec(
    r.state,
    command('iis.addBinding', srv, 'Default Web Site', { protocol: 'https', certificate: r.value })
  )
  return { state: s, thumbprint: r.value }
}

describe('AD CS', () => {
  it('autorité racine d’entreprise : nom par défaut, certificat d’AC, modèles publiés', () => {
    const s = caLab()
    const ca = adcsOf(s.devices[id(s, 'SRV1')])!
    expect(ca.caName).toBe('LAB-SRV1-CA')
    expect(ca.templates).toEqual(expect.arrayContaining(['WebServer', 'Machine', 'User']))
    expect(roots(s, 'SRV1').map((c) => c.subject)).toEqual(['CN=LAB-SRV1-CA'])
    const again = dispatch(s, command('adcs.install', id(s, 'SRV1'), {}))
    expect(!again.ok && again.error.code).toBe('AdcsConfigured')
    expect(evaluateCheck(s, { type: 'enterpriseCa', server: 'SRV1', name: 'lab-srv1-ca' })).toBe(true)
  })

  it('le certificat racine est distribué aux membres du domaine par la stratégie ordinateur', () => {
    let s = caLab()
    expect(roots(s, 'PC1')).toEqual([])
    s = gpupdate(s, 'PC1')
    expect(roots(s, 'PC1').map((c) => c.subject)).toEqual(['CN=LAB-SRV1-CA'])
    // PC2 n'est pas membre du domaine : pas de certificat racine
    expect(roots(s, 'PC2')).toEqual([])
  })

  it('acceptation : certificat IIS émis par l’AC interne, approuvé par les postes du domaine', () => {
    let { state: s } = withHttps(caLab())
    const before = httpGet(s, id(s, 'PC1'), 'https://intranet.lab.local')
    expect(before.kind === 'response' && before.certificateWarning).toMatch(
      /autorité de certification approuvée/
    )
    s = gpupdate(s, 'PC1')
    const after = httpGet(s, id(s, 'PC1'), 'https://intranet.lab.local')
    expect(after.kind === 'response' && [after.status, after.certificateWarning]).toEqual([200, null])
    expect(after.kind === 'response' && after.certificate?.issuer).toBe('CN=LAB-SRV1-CA')
    expect(
      evaluateCheck(s, {
        type: 'httpResponse',
        from: 'PC1',
        url: 'https://intranet.lab.local',
        trusted: true
      })
    ).toBe(true)
    expect(
      evaluateCheck(s, {
        type: 'certificate',
        device: 'SRV1',
        dnsName: 'intranet.lab.local',
        fromCa: true,
        trustedBy: 'PC1'
      })
    ).toBe(true)
  })

  it('révocation : le navigateur signale un certificat révoqué', () => {
    const https = withHttps(caLab())
    const thumbprint = https.thumbprint
    let s = gpupdate(https.state, 'PC1')
    const srv = id(s, 'SRV1')
    const serial = adcsOf(s.devices[srv])!.issued.find((c) => c.thumbprint === thumbprint)!.serial
    s = exec(s, command('adcs.revoke', srv, serial, 'KeyCompromise'))
    const r = httpGet(s, id(s, 'PC1'), 'https://intranet.lab.local')
    expect(r.kind === 'response' && r.certificateWarning).toMatch(/révoqué/)
    const twice = dispatch(s, command('adcs.revoke', srv, serial, 'Unspecified'))
    expect(!twice.ok && twice.error.code).toBe('AlreadyRevoked')
    expect(
      evaluateCheck(s, { type: 'certificate', device: 'SRV1', dnsName: 'intranet.lab.local', revoked: true })
    ).toBe(true)
  })

  it('inscription automatique par GPO : certificat Ordinateur délivré au poste', () => {
    let s = caLab()
    const srv = id(s, 'SRV1')
    s = exec(s, command('gpo.createAndLink', D, { name: 'PKI' }, null))
    const gpo = s.domains[D]!.gpos.find((g) => g.name === 'PKI')!
    s = exec(s, command('gpo.updateSettings', D, gpo.id, { computer: { autoEnrollment: 'Enabled' } }))
    s = gpupdate(s, 'PC1')
    const mine = host(s, 'PC1').host.certificates.filter((c) => c.store === 'My')
    expect(mine.map((c) => [c.subject, c.issuer])).toEqual([['CN=pc1.lab.local', 'CN=LAB-SRV1-CA']])
    expect(adcsOf(s.devices[srv])!.issued.map((c) => [c.template, c.requester])).toEqual([['Machine', 'PC1']])
    // Un second traitement ne réinscrit pas
    s = gpupdate(s, 'PC1')
    expect(adcsOf(s.devices[srv])!.issued).toHaveLength(1)
    // Modèle Ordinateur retiré : pas d'inscription pour un autre membre
    s = exec(s, command('adcs.removeTemplate', srv, 'Ordinateur'))
    s = exec(s, command('adcs.pulse', srv))
    expect(adcsOf(s.devices[srv])!.issued).toHaveLength(1)
    expect(
      evaluateCheck(s, { type: 'caTemplate', server: 'SRV1', template: 'Machine', published: false })
    ).toBe(true)
  })

  it('demandes refusées : poste hors domaine, modèle non publié ou utilisateur, nom DNS manquant', () => {
    let s = caLab()
    const srv = id(s, 'SRV1')
    const outside = dispatch(s, command('adcs.request', id(s, 'PC2'), { template: 'Machine' }))
    expect(!outside.ok && outside.error.code).toBe('NotDomainMember')
    const user = dispatch(s, command('adcs.request', srv, { template: 'User' }))
    expect(!user.ok && user.error.code).toBe('TemplateNotSupported')
    const noName = dispatch(s, command('adcs.request', srv, { template: 'WebServer' }))
    expect(!noName.ok && noName.error.code).toBe('InvalidArgument')
    s = exec(s, command('adcs.removeTemplate', srv, 'WebServer'))
    const unpublished = dispatch(
      s,
      command('adcs.request', srv, { template: 'WebServer', dnsNames: ['x.lab.local'] })
    )
    expect(!unpublished.ok && unpublished.error.code).toBe('TemplateNotFound')
    s = exec(s, command('adcs.addTemplate', srv, 'Serveur Web'))
    expect(adcsOf(s.devices[srv])!.templates).toContain('WebServer')
  })

  it('cmdlets et certutil', () => {
    let s = buildReferenceLab()
    const srv = id(s, 'SRV1')
    s = unwrap(installFeatures(s, srv, ['ADCS-Cert-Authority'], { includeManagementTools: true })).state
    expect(run(s, srv, 'Get-CATemplate').errors).toMatch(/n’est pas configurée/)
    const typeErr = run(s, srv, 'Install-AdcsCertificationAuthority -CAType StandaloneRootCA -Force')
    expect(typeErr.errors).toMatch(/EnterpriseRootCA/)
    s = run(
      s,
      srv,
      "Install-AdcsCertificationAuthority -CAType EnterpriseRootCA -CACommonName 'LAB-CA' -Force"
    ).state
    expect(adcsOf(s.devices[srv])!.caName).toBe('LAB-CA')
    expect(run(s, srv, 'Get-CATemplate').text).toContain('WebServer')
    s = run(s, srv, 'Remove-CATemplate -Name Administrator -Force').state
    s = run(s, srv, 'Add-CATemplate -Name Workstation -Force').state
    expect(adcsOf(s.devices[srv])!.templates).toContain('Workstation')
    const r = run(
      s,
      srv,
      'Get-Certificate -Template WebServer -DnsName www.lab.local -CertStoreLocation Cert:\\LocalMachine\\My'
    )
    expect(r.text).toMatch(/Status\s+: Issued/)
    s = r.state
    const serial = adcsOf(s.devices[srv])!.issued[0]!.serial
    const revoke = run(s, srv, `certutil -revoke ${serial} 1`, { shell: 'cmd' })
    expect(revoke.text).toContain('CertUtil: -revoke La commande s’est terminée correctement.')
    s = revoke.state
    expect(adcsOf(s.devices[srv])!.issued[0]).toMatchObject({ revoked: true, reason: 'KeyCompromise' })
    s = run(s, id(s, 'PC1'), 'certutil -pulse', { shell: 'cmd' }).state
    expect(run(s, id(s, 'PC1'), 'certutil -store Root', { shell: 'cmd' }).text).toContain('Objet: CN=LAB-CA')
  })
})
