/**
 * Cmdlets des sites, de la réplication et des contrôleurs (modules ActiveDirectory et
 * ADDSDeployment) : sites, sous-réseaux, liens de sites, Move-ADDirectoryServer,
 * Get-ADDomainController, Install-ADDSDomainController, transfert des rôles FSMO.
 */
import { guidFromSeed } from '../../core/guid'
import type { Domain, FsmoRole } from '../../model/schema'
import { FSMO_ROLES } from '../../model/schema'
import { psError } from '../../shell/ps/errors'
import type { CmdContext } from '../../shell/ps/interpreter'
import type { CmdletDef } from '../../shell/ps/registry'
import { flatten, isCredential, psObject, psToString, type PsValue } from '../../shell/ps/values'
import { hasFeature } from '../../shell/ps/cmdlets/helpers'
import { adAvailable, adDomain, secureText } from './cmdlets'
import { domainDn } from './directory'
import { fsmoRolesOf, moveFsmoRoles, parseFsmoRole } from './fsmo'
import { installDomainController } from './promote'
import {
  addressOf,
  dcSite,
  moveDcToSite,
  newSite,
  newSiteLink,
  newSubnet,
  removeAdSite,
  removeSiteLink,
  removeSubnet,
  setSiteLink
} from './sites'

const str = (v: PsValue | undefined) => psToString(v)
const list = (v: PsValue | undefined) =>
  flatten(v === undefined ? [] : [v])
    .flatMap((x) => psToString(x).split(','))
    .map((x) => x.trim())
    .filter(Boolean)

const configDn = (domain: Domain) => `CN=Configuration,${domainDn(domain)}`
const siteDn = (domain: Domain, site: string) => `CN=${site},CN=Sites,${configDn(domain)}`

function notFound(domain: Domain, identity: string) {
  return psError(
    `Impossible de trouver un objet avec l’identité « ${identity} » sous « ${configDn(domain)} ».`,
    'ObjectNotFound',
    'ActiveDirectoryCmdlet:ActiveDirectory.Management.ADIdentityNotFoundException',
    identity,
    'ADIdentityNotFoundException'
  )
}

/** Nom court d'une identité (nom ou nom unique « CN=Paris,CN=Sites,… »). */
const shortName = (identity: string) => /^CN=([^,]+)/i.exec(identity.trim())?.[1] ?? identity.trim()

function siteObject(domain: Domain, name: string, description: string) {
  return psObject(
    'ADReplicationSite',
    { Description: description, DistinguishedName: siteDn(domain, name), Name: name, ObjectClass: 'site' },
    { kind: 'list', props: ['Description', 'DistinguishedName', 'Name', 'ObjectClass'] }
  )
}

/** Contrôleur désigné par son nom (SRV2, SRV2.lab.local). */
function controllerByName(ctx: CmdContext, domain: Domain, identity: string): string {
  const name = identity.trim().split('.')[0]?.toLowerCase() ?? ''
  const id = domain.controllers.find((d) => ctx.state.devices[d]?.name.toLowerCase() === name)
  if (!id) throw notFound(domain, identity)
  return id
}

function controllerObject(ctx: CmdContext, domain: Domain, id: string) {
  const device = ctx.state.devices[id]
  const name = device?.name ?? id
  return psObject(
    'ADDomainController',
    {
      Domain: domain.name,
      Forest: domain.name,
      HostName: `${name.toLowerCase()}.${domain.name}`,
      IPv4Address: addressOf(ctx.state, id) ?? '',
      IsGlobalCatalog: true,
      IsReadOnly: false,
      Name: name,
      OperationMasterRoles: `{${fsmoRolesOf(domain, id).join(', ')}}`,
      Site: dcSite(domain, id)
    },
    {
      kind: 'list',
      props: [
        'Domain',
        'Forest',
        'HostName',
        'IPv4Address',
        'IsGlobalCatalog',
        'IsReadOnly',
        'Name',
        'OperationMasterRoles',
        'Site'
      ]
    }
  )
}

export const siteCmdlets: CmdletDef[] = [
  {
    name: 'Get-ADReplicationSite',
    module: 'ActiveDirectory',
    synopsis: 'Affiche les sites Active Directory.',
    available: adAvailable,
    params: [
      { name: 'Identity', type: 'string', position: 0 },
      { name: 'Filter', type: 'any' }
    ],
    run(ctx, args) {
      const domain = adDomain(ctx)
      if (args['Identity'] !== undefined) {
        const name = shortName(str(args['Identity']))
        const site = domain.sites.find((s) => s.name.toLowerCase() === name.toLowerCase())
        if (!site) throw notFound(domain, str(args['Identity']))
        return [siteObject(domain, site.name, site.description)]
      }
      return domain.sites.map((s) => siteObject(domain, s.name, s.description))
    }
  },
  {
    name: 'New-ADReplicationSite',
    module: 'ActiveDirectory',
    synopsis: 'Crée un site Active Directory.',
    available: adAvailable,
    params: [
      { name: 'Name', type: 'string', mandatory: true, position: 0 },
      { name: 'Description', type: 'string' }
    ],
    run(ctx, args) {
      const domain = adDomain(ctx, true)
      ctx.apply(
        newSite(ctx.state, domain.name, {
          name: str(args['Name']),
          ...(args['Description'] !== undefined ? { description: str(args['Description']) } : {})
        })
      )
      return []
    }
  },
  {
    name: 'Remove-ADReplicationSite',
    module: 'ActiveDirectory',
    synopsis: 'Supprime un site Active Directory sans contrôleur.',
    available: adAvailable,
    params: [{ name: 'Identity', type: 'string', mandatory: true, position: 0 }],
    run(ctx, args) {
      const domain = adDomain(ctx, true)
      const name = shortName(str(args['Identity']))
      if (!ctx.confirm(name, 'Remove')) return []
      ctx.apply(removeAdSite(ctx.state, domain.name, name))
      return []
    }
  },
  {
    name: 'Get-ADReplicationSubnet',
    module: 'ActiveDirectory',
    synopsis: 'Affiche les sous-réseaux des sites.',
    available: adAvailable,
    params: [
      { name: 'Identity', type: 'string', position: 0 },
      { name: 'Filter', type: 'any' }
    ],
    run(ctx, args) {
      const domain = adDomain(ctx)
      const wanted = args['Identity'] !== undefined ? shortName(str(args['Identity'])) : null
      const subnets = domain.subnets.filter((s) => !wanted || s.prefix === wanted)
      if (wanted && subnets.length === 0) throw notFound(domain, wanted)
      return subnets.map((s) =>
        psObject(
          'ADReplicationSubnet',
          {
            DistinguishedName: `CN=${s.prefix},CN=Subnets,CN=Sites,${configDn(domain)}`,
            Location: s.description,
            Name: s.prefix,
            ObjectClass: 'subnet',
            Site: siteDn(domain, s.site)
          },
          { kind: 'list', props: ['DistinguishedName', 'Location', 'Name', 'ObjectClass', 'Site'] }
        )
      )
    }
  },
  {
    name: 'New-ADReplicationSubnet',
    module: 'ActiveDirectory',
    synopsis: 'Crée un sous-réseau et l’associe à un site.',
    available: adAvailable,
    params: [
      { name: 'Name', type: 'string', mandatory: true, position: 0 },
      { name: 'Site', type: 'string' },
      { name: 'Location', type: 'string' }
    ],
    run(ctx, args) {
      const domain = adDomain(ctx, true)
      if (args['Site'] === undefined)
        throw psError(
          'Indiquez le site du sous-réseau (-Site) : un sous-réseau sans site n’est utilisé par aucun client.',
          'InvalidArgument',
          'SiteRequired'
        )
      ctx.apply(
        newSubnet(ctx.state, domain.name, {
          prefix: str(args['Name']),
          site: shortName(str(args['Site'])),
          ...(args['Location'] !== undefined ? { description: str(args['Location']) } : {})
        })
      )
      return []
    }
  },
  {
    name: 'Remove-ADReplicationSubnet',
    module: 'ActiveDirectory',
    synopsis: 'Supprime un sous-réseau.',
    available: adAvailable,
    params: [{ name: 'Identity', type: 'string', mandatory: true, position: 0 }],
    run(ctx, args) {
      const domain = adDomain(ctx, true)
      const prefix = shortName(str(args['Identity']))
      if (!ctx.confirm(prefix, 'Remove')) return []
      ctx.apply(removeSubnet(ctx.state, domain.name, prefix))
      return []
    }
  },
  {
    name: 'Get-ADReplicationSiteLink',
    module: 'ActiveDirectory',
    synopsis: 'Affiche les liens de sites.',
    available: adAvailable,
    params: [
      { name: 'Identity', type: 'string', position: 0 },
      { name: 'Filter', type: 'any' }
    ],
    run(ctx, args) {
      const domain = adDomain(ctx)
      const wanted = args['Identity'] !== undefined ? shortName(str(args['Identity'])).toLowerCase() : null
      const links = domain.siteLinks.filter((l) => !wanted || l.name.toLowerCase() === wanted)
      if (wanted && links.length === 0) throw notFound(domain, str(args['Identity']))
      return links.map((l) =>
        psObject(
          'ADReplicationSiteLink',
          {
            Cost: l.cost,
            DistinguishedName: `CN=${l.name},CN=IP,CN=Inter-Site Transports,CN=Sites,${configDn(domain)}`,
            Name: l.name,
            ReplicationFrequencyInMinutes: l.interval,
            SitesIncluded: `{${l.sites.map((s) => siteDn(domain, s)).join(', ')}}`
          },
          {
            kind: 'list',
            props: ['Cost', 'DistinguishedName', 'Name', 'ReplicationFrequencyInMinutes', 'SitesIncluded']
          }
        )
      )
    }
  },
  {
    name: 'New-ADReplicationSiteLink',
    module: 'ActiveDirectory',
    synopsis: 'Crée un lien de sites (transport IP).',
    available: adAvailable,
    params: [
      { name: 'Name', type: 'string', mandatory: true, position: 0 },
      { name: 'SitesIncluded', type: 'string[]', mandatory: true },
      { name: 'Cost', type: 'int' },
      { name: 'ReplicationFrequencyInMinutes', type: 'int' },
      { name: 'InterSiteTransportProtocol', type: 'string', validateSet: ['IP', 'SMTP'] }
    ],
    run(ctx, args) {
      const domain = adDomain(ctx, true)
      if (args['InterSiteTransportProtocol'] === 'SMTP')
        throw psError('Le transport SMTP n’est pas simulé : utilisez IP.', 'NotImplemented', 'NotSupported')
      ctx.apply(
        newSiteLink(ctx.state, domain.name, {
          name: str(args['Name']),
          sites: list(args['SitesIncluded']).map(shortName),
          ...(args['Cost'] !== undefined ? { cost: Number(args['Cost']) } : {}),
          ...(args['ReplicationFrequencyInMinutes'] !== undefined
            ? { interval: Number(args['ReplicationFrequencyInMinutes']) }
            : {})
        })
      )
      return []
    }
  },
  {
    name: 'Set-ADReplicationSiteLink',
    module: 'ActiveDirectory',
    synopsis: 'Modifie le coût, l’intervalle ou les sites d’un lien de sites.',
    available: adAvailable,
    params: [
      { name: 'Identity', type: 'string', mandatory: true, position: 0 },
      { name: 'Cost', type: 'int' },
      { name: 'ReplicationFrequencyInMinutes', type: 'int' },
      { name: 'SitesIncluded', type: 'string[]' }
    ],
    run(ctx, args) {
      const domain = adDomain(ctx, true)
      ctx.apply(
        setSiteLink(ctx.state, domain.name, shortName(str(args['Identity'])), {
          ...(args['Cost'] !== undefined ? { cost: Number(args['Cost']) } : {}),
          ...(args['ReplicationFrequencyInMinutes'] !== undefined
            ? { interval: Number(args['ReplicationFrequencyInMinutes']) }
            : {}),
          ...(args['SitesIncluded'] !== undefined
            ? { sites: list(args['SitesIncluded']).map(shortName) }
            : {})
        })
      )
      return []
    }
  },
  {
    name: 'Remove-ADReplicationSiteLink',
    module: 'ActiveDirectory',
    synopsis: 'Supprime un lien de sites.',
    available: adAvailable,
    params: [{ name: 'Identity', type: 'string', mandatory: true, position: 0 }],
    run(ctx, args) {
      const domain = adDomain(ctx, true)
      const name = shortName(str(args['Identity']))
      if (!ctx.confirm(name, 'Remove')) return []
      ctx.apply(removeSiteLink(ctx.state, domain.name, name))
      return []
    }
  },
  {
    name: 'Move-ADDirectoryServer',
    module: 'ActiveDirectory',
    synopsis: 'Déplace un contrôleur de domaine dans un autre site.',
    available: adAvailable,
    params: [
      { name: 'Identity', type: 'string', mandatory: true, position: 0 },
      { name: 'Site', type: 'string', mandatory: true, position: 1 }
    ],
    run(ctx, args) {
      const domain = adDomain(ctx, true)
      const dcId = controllerByName(ctx, domain, str(args['Identity']))
      ctx.apply(moveDcToSite(ctx.state, domain.name, dcId, shortName(str(args['Site']))))
      return []
    }
  },
  {
    name: 'Get-ADDomainController',
    module: 'ActiveDirectory',
    synopsis: 'Affiche les contrôleurs du domaine (site, rôles FSMO).',
    available: adAvailable,
    params: [
      { name: 'Identity', type: 'string', position: 0 },
      { name: 'Filter', type: 'any' }
    ],
    run(ctx, args) {
      const domain = adDomain(ctx)
      if (args['Identity'] !== undefined)
        return [controllerObject(ctx, domain, controllerByName(ctx, domain, str(args['Identity'])))]
      if (args['Filter'] !== undefined)
        return domain.controllers.map((id) => controllerObject(ctx, domain, id))
      // Sans paramètre : le contrôleur de la session (contrôleur local, sinon celui de l'ouverture de session)
      const local = domain.controllers.find((id) => id === ctx.deviceId)
      const logon = ctx.host.host.session?.logonServer?.toLowerCase()
      const id =
        local ??
        domain.controllers.find((d) => ctx.state.devices[d]?.name.toLowerCase() === logon) ??
        domain.controllers[0]
      return id ? [controllerObject(ctx, domain, id)] : []
    }
  },
  {
    name: 'Install-ADDSDomainController',
    module: 'ADDSDeployment',
    synopsis: 'Ajoute ce serveur comme contrôleur d’un domaine existant.',
    available: (ctx) => hasFeature(ctx, 'AD-Domain-Services'),
    params: [
      { name: 'DomainName', type: 'string', mandatory: true },
      { name: 'Credential', type: 'credential', mandatory: true },
      { name: 'SafeModeAdministratorPassword', type: 'secure', mandatory: true, confirm: true },
      { name: 'SiteName', type: 'string' },
      { name: 'InstallDns', type: 'switch' },
      { name: 'Force', type: 'switch' },
      { name: 'NoRebootOnCompletion', type: 'switch' },
      { name: 'DatabasePath', type: 'string' },
      { name: 'LogPath', type: 'string' },
      { name: 'SysvolPath', type: 'string' }
    ],
    run(ctx, args) {
      const cred = args['Credential']
      if (!isCredential(cred ?? null))
        throw psError('Informations d’identification invalides.', 'InvalidArgument', 'InvalidCredential')
      const credential = cred as { user: string; password: string }
      if (args['Force'] !== true) {
        ctx.writeLines([
          'Le serveur cible sera configuré en tant que contrôleur de domaine et redémarré une fois cette opération terminée.'
        ])
        const answer = ctx
          .ask(
            'Voulez-vous continuer cette opération ?\n[O] Oui  [T] Oui pour tout  [N] Non  [U] Non pour tout  [?] Aide (la valeur par défaut est « O ») : '
          )
          .trim()
          .toLowerCase()
        if (answer !== '' && answer !== 'o' && answer !== 't') return []
      }
      const op = installDomainController(ctx.state, ctx.deviceId, {
        domainName: str(args['DomainName']),
        user: credential.user,
        password: credential.password,
        safeModePassword: secureText(args['SafeModeAdministratorPassword']) ?? '',
        site: args['SiteName'] !== undefined ? str(args['SiteName']) : null,
        installDns: true
      })
      ctx.addTrace(op.trace)
      if (!op.ok) throw psError(op.message, 'InvalidOperation', 'Test.VerifyDcPromoCore.DCPromo.General.77')
      ctx.state = op.state
      ctx.writeLines([
        '',
        'Message                                  Context           RebootRequired  Status',
        '-------                                  -------           --------------  ------',
        `L’opération a réussi.                    DCPromo.General.1          False Success`,
        '',
        'Vous allez être déconnecté : l’ordinateur redémarre pour terminer la promotion…'
      ])
      ctx.exit = true
      return []
    }
  },
  {
    name: 'Move-ADDirectoryServerOperationMasterRole',
    module: 'ActiveDirectory',
    synopsis: 'Transfère (ou prend de force avec -Force) des rôles de maître d’opérations.',
    available: adAvailable,
    params: [
      { name: 'Identity', type: 'string', mandatory: true, position: 0 },
      { name: 'OperationMasterRole', type: 'string[]', mandatory: true, position: 1 },
      { name: 'Force', type: 'switch' }
    ],
    run(ctx, args) {
      const domain = adDomain(ctx, true)
      const target = controllerByName(ctx, domain, str(args['Identity']))
      const roles: FsmoRole[] = list(args['OperationMasterRole']).map((r) => {
        const role = parseFsmoRole(r)
        if (!role)
          throw psError(
            `Impossible de lier le paramètre « OperationMasterRole ». Valeurs possibles : ${FSMO_ROLES.join(', ')}.`,
            'InvalidArgument',
            'CannotConvertArgumentNoMessage'
          )
        return role
      })
      const name = ctx.state.devices[target]?.name ?? ''
      if (!ctx.confirm(name, `Move-ADDirectoryServerOperationMasterRole : ${roles.join(', ')}`)) return []
      ctx.apply(moveFsmoRoles(ctx.state, domain.name, target, roles, { force: args['Force'] === true }))
      return []
    }
  }
]

/** Identifiant stable d'un objet de configuration (GUID dérivé du nom). */
export const configGuid = (name: string) => guidFromSeed(`config:${name}`)
