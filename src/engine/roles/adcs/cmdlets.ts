/**
 * Cmdlets AD CS : déploiement de l'autorité (ADCSDeployment), modèles publiés
 * (ADCSAdministration) et demande de certificat d'un ordinateur (PKI : Get-Certificate).
 */
import { psError } from '../../shell/ps/errors'
import type { CmdContext } from '../../shell/ps/interpreter'
import type { CmdletDef } from '../../shell/ps/registry'
import { flatten, psObject, psToString, type PsValue } from '../../shell/ps/values'
import { hasFeature } from '../../shell/ps/cmdlets/helpers'
import { addCaTemplate, installCertificationAuthority, removeCaTemplate, requestCertificate } from './actions'
import { adcsOf, CERT_TEMPLATES } from './state'

const str = (v: PsValue | undefined): string => psToString(v)
const isCa = (ctx: CmdContext) => hasFeature(ctx, 'ADCS-Cert-Authority')

function requireConfiguredCa(ctx: CmdContext) {
  const ca = adcsOf(ctx.device)
  if (!ca?.configured)
    throw psError(
      'L’autorité de certification n’est pas configurée sur cet ordinateur.',
      'ObjectNotFound',
      'CertificationAuthorityNotFound'
    )
  return ca
}

export const adcsCmdlets: CmdletDef[] = [
  {
    name: 'Install-AdcsCertificationAuthority',
    module: 'ADCSDeployment',
    synopsis: 'Configure l’autorité de certification.',
    available: isCa,
    params: [
      {
        name: 'CAType',
        type: 'string',
        validateSet: [
          'EnterpriseRootCA',
          'EnterpriseSubordinateCA',
          'StandaloneRootCA',
          'StandaloneSubordinateCA'
        ]
      },
      { name: 'CACommonName', type: 'string' },
      { name: 'ValidityPeriod', type: 'string' },
      { name: 'ValidityPeriodUnits', type: 'int' },
      { name: 'Force', type: 'switch' }
    ],
    run(ctx, args) {
      const type = args['CAType'] ? str(args['CAType']) : 'EnterpriseRootCA'
      if (type !== 'EnterpriseRootCA')
        throw psError(
          `Le type d’autorité « ${type} » n’est pas simulé : seule une autorité racine d’entreprise (EnterpriseRootCA) est disponible.`,
          'InvalidArgument',
          'CAType'
        )
      const caName = args['CACommonName'] ? str(args['CACommonName']) : undefined
      if (!ctx.confirm(ctx.device.name, 'Configurer les services de certificats Active Directory')) return
      ctx.apply(installCertificationAuthority(ctx.state, ctx.deviceId, caName ? { caName } : {}))
      return [
        psObject(
          'Microsoft.CertificateServices.Deployment.Common.CertificationAuthoritySetupResult',
          {
            ErrorId: 0,
            ErrorString: ''
          },
          { kind: 'table', props: ['ErrorId', 'ErrorString'] }
        )
      ]
    }
  },
  {
    name: 'Get-CATemplate',
    module: 'ADCSAdministration',
    synopsis: 'Liste les modèles de certificats publiés par l’autorité.',
    available: isCa,
    params: [],
    run(ctx) {
      return requireConfiguredCa(ctx).templates.map((t) =>
        psObject(
          'Microsoft.CertificateServices.Administration.Commands.CA.CATemplate',
          { Name: t, Oid: '' },
          { kind: 'table', props: ['Name', 'Oid'] }
        )
      )
    }
  },
  {
    name: 'Add-CATemplate',
    module: 'ADCSAdministration',
    synopsis: 'Publie un modèle de certificat.',
    available: isCa,
    params: [
      {
        name: 'Name',
        type: 'string',
        mandatory: true,
        position: 0,
        complete: () => Object.keys(CERT_TEMPLATES)
      },
      { name: 'Force', type: 'switch' }
    ],
    run(ctx, args) {
      requireConfiguredCa(ctx)
      const name = str(args['Name'])
      if (!ctx.confirm(name, 'Ajouter le modèle de certificat')) return
      ctx.apply(addCaTemplate(ctx.state, ctx.deviceId, name))
    }
  },
  {
    name: 'Remove-CATemplate',
    module: 'ADCSAdministration',
    synopsis: 'Retire un modèle de certificat publié.',
    available: isCa,
    params: [
      { name: 'Name', type: 'string', mandatory: true, position: 0 },
      { name: 'Force', type: 'switch' }
    ],
    run(ctx, args) {
      requireConfiguredCa(ctx)
      const name = str(args['Name'])
      if (!ctx.confirm(name, 'Supprimer le modèle de certificat')) return
      ctx.apply(removeCaTemplate(ctx.state, ctx.deviceId, name))
    }
  },
  {
    name: 'Get-Certificate',
    module: 'PKI',
    synopsis: 'Demande un certificat à l’autorité de certification d’entreprise.',
    params: [
      { name: 'Template', type: 'string', mandatory: true },
      { name: 'DnsName', type: 'string[]' },
      { name: 'SubjectName', type: 'string' },
      { name: 'CertStoreLocation', type: 'string' }
    ],
    run(ctx, args) {
      const store = str(args['CertStoreLocation'] ?? 'Cert:\\LocalMachine\\My')
      if (!/^cert:\\localmachine\\my\\?$/i.test(store))
        throw psError(
          'Seul le magasin Cert:\\LocalMachine\\My est simulé : indiquez -CertStoreLocation Cert:\\LocalMachine\\My.',
          'InvalidArgument',
          'CertStoreLocation'
        )
      const names = args['DnsName'] ? flatten([args['DnsName']]).map((n) => str(n)) : []
      const subject = args['SubjectName'] ? str(args['SubjectName']).replace(/^CN=/i, '') : null
      const dnsNames = names.length > 0 ? names : subject ? [subject] : []
      const thumbprint = ctx.apply(
        requestCertificate(ctx.state, ctx.deviceId, { template: str(args['Template']), dnsNames })
      )
      return [
        psObject(
          'Microsoft.CertificateServices.Commands.EnrollmentResult',
          {
            Status: 'Issued',
            Certificate: `[Subject] CN=${dnsNames[0] ?? ctx.device.name} [Thumbprint] ${thumbprint}`
          },
          { kind: 'list', props: ['Status', 'Certificate'] }
        )
      ]
    }
  }
]
