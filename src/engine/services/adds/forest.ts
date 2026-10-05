/**
 * Promotion d'un serveur en contrôleur de domaine d'une nouvelle forêt (Install-ADDSForest).
 */
import { logEvent } from '../../core/eventlog'
import { raise, transact, type EngineResult } from '../../core/result'
import type { LabState } from '../../model/schema'
import { effectiveIpv4 } from '../../net/addressing'
import { isLoopback } from '../../net/ipv4'
import { requireDevice } from '../../topology/actions'
import { createDnsServer, validDnsName } from '../dns'
import { applyRestart } from '../system'
import { buildDomain, passwordMeetsPolicy } from './directory'

export interface ForestInput {
  domainName: string
  netbios?: string
  safeModePassword: string
  installDns?: boolean
}

export interface ForestResult {
  domain: string
  netbios: string
  warnings: string[]
}

/** Enregistrements DNS publiés par un contrôleur de domaine. */
function dcRecords(dcName: string, domain: string, ip: string) {
  const fqdn = `${dcName.toLowerCase()}.${domain}.`
  const srv = (name: string, port: number) => ({
    name,
    type: 'SRV' as const,
    data: `0 100 ${port} ${fqdn}`,
    ttl: 600,
    dynamic: true
  })
  return [
    { name: '@', type: 'A' as const, data: ip, ttl: 600, dynamic: true },
    { name: dcName.toLowerCase(), type: 'A' as const, data: ip, ttl: 3600, dynamic: true },
    srv('_ldap._tcp', 389),
    srv('_kerberos._tcp', 88),
    srv('_ldap._tcp.dc._msdcs', 389),
    srv('_kerberos._tcp.dc._msdcs', 88),
    srv('_gc._tcp', 3268)
  ]
}

export function installForest(
  state: LabState,
  deviceId: string,
  input: ForestInput
): EngineResult<ForestResult> {
  return transact(state, (draft) => {
    const device = requireDevice(draft, deviceId)
    if (device.kind !== 'server') raise('NotServer', 'Seul un serveur peut devenir contrôleur de domaine.')
    if (!device.host.features.includes('AD-Domain-Services'))
      raise(
        'RoleMissing',
        'Le rôle Services AD DS doit être installé avant la promotion (Install-WindowsFeature AD-Domain-Services).'
      )
    if (device.host.domain)
      raise('AlreadyMember', `Ce serveur appartient déjà au domaine ${device.host.domain}.`)
    const name = input.domainName.trim().toLowerCase().replace(/\.$/, '')
    if (!validDnsName(name) || !name.includes('.'))
      raise(
        'InvalidDomainName',
        `Le nom de domaine « ${input.domainName} » n’est pas valide : utilisez un nom DNS complet (exemple : lab.local).`
      )
    if (draft.domains[name]) raise('DomainExists', `Le domaine ${name} existe déjà dans le réseau.`)
    const netbios = (input.netbios?.trim() || (name.split('.')[0] ?? 'DOMAINE')).toUpperCase().slice(0, 15)
    if (!/^[A-Z0-9-]+$/.test(netbios))
      raise('InvalidNetbios', `Le nom NetBIOS « ${netbios} » n’est pas valide.`)
    if (Object.values(draft.domains).some((d) => d.netbios === netbios))
      raise('NetbiosExists', `Le nom NetBIOS ${netbios} est déjà utilisé.`)
    if (!passwordMeetsPolicy(input.safeModePassword))
      raise(
        'WeakDsrmPassword',
        `Le mot de passe du mode de restauration des services d’annuaire ne répond pas aux exigences : ${'au moins 7 caractères et trois catégories (majuscules, minuscules, chiffres, symboles)'}.`
      )
    if (!device.host.localAdminPassword)
      raise(
        'BlankAdminPassword',
        'Le mot de passe du compte Administrateur local est vide : définissez-en un avant la promotion.'
      )

    const warnings: string[] = []
    const staticIface = device.interfaces.find((i) => effectiveIpv4(i)?.source === 'static')
    if (device.interfaces.some((i) => i.l3 && i.addressing === 'dhcp'))
      warnings.push(
        'Cet ordinateur a au moins une carte réseau physique pour laquelle aucune adresse IP statique n’est attribuée à ses propriétés IP. Si IPv4 et IPv6 sont activés, des adresses statiques doivent leur être attribuées pour un fonctionnement fiable du serveur DNS.'
      )
    warnings.push(
      `Impossible de créer une délégation pour ce serveur DNS, car la zone parente faisant autorité est introuvable ou elle n’exécute pas le serveur DNS. Si vous procédez à l’intégration avec une infrastructure DNS existante, vous devez manuellement créer une délégation avec ce serveur DNS dans la zone parente pour activer une résolution de noms fiable en dehors du domaine « ${name} ». Sinon, aucune action n’est requise.`
    )

    const domain = buildDomain(draft, name, netbios, device.host.localAdminPassword, {
      deviceId,
      name: device.name
    })
    draft.domains[name] = domain
    device.host.domain = name
    device.host.workgroup = netbios

    if (input.installDns ?? true) {
      for (const f of ['DNS', 'RSAT-DNS-Server'])
        if (!device.host.features.includes(f)) device.host.features.push(f)
      if (!device.services.dns) device.services.dns = createDnsServer()
      const dns = device.services.dns
      const ip = staticIface
        ? (effectiveIpv4(staticIface)?.address ?? '127.0.0.1')
        : (device.interfaces.map((i) => effectiveIpv4(i)?.address).find((a) => a) ?? '127.0.0.1')
      const fqdn = `${device.name.toLowerCase()}.${name}`
      dns.zones = dns.zones.filter((z) => z.name !== name)
      dns.zones.push({
        name,
        reverse: false,
        adIntegrated: true,
        dynamicUpdate: 'Secure',
        records: [
          {
            name: '@',
            type: 'SOA',
            data: `${fqdn}. hostmaster.${name}. 1 900 600 86400 3600`,
            ttl: 3600,
            dynamic: false
          },
          { name: '@', type: 'NS', data: `${fqdn}.`, ttl: 3600, dynamic: false },
          ...dcRecords(device.name, name, ip)
        ]
      })
      // Le serveur utilise désormais son propre service DNS ; les anciens serveurs deviennent redirecteurs
      if (staticIface) {
        const previous = staticIface.dnsServers.filter((s) => !isLoopback(s) && s !== ip)
        for (const p of previous) if (!dns.forwarders.includes(p)) dns.forwarders.push(p)
        staticIface.dnsMode = 'static'
        staticIface.dnsServers = ['127.0.0.1']
      }
    }

    logEvent(draft, deviceId, {
      level: 'information',
      source: 'ActiveDirectory_DomainService',
      eventId: 1000,
      log: 'Service d’annuaire',
      message: `Le démarrage des services de domaine Active Directory est terminé. Ce serveur est contrôleur du domaine ${name} (${netbios}).`
    })
    // Redémarrage automatique en fin de promotion ; session rouverte en administrateur du domaine
    device.host.session = { user: 'Administrateur', domain: netbios }
    applyRestart(draft, device)
    device.host.session = { user: 'Administrateur', domain: netbios }
    return { domain: name, netbios, warnings }
  })
}
