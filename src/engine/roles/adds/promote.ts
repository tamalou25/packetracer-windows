/**
 * Ajout d'un contrôleur de domaine à un domaine existant (Install-ADDSDomainController,
 * assistant de promotion) : localisation d'un DC par le DNS, identifiants d'un administrateur
 * du domaine, choix du site, copie des zones DNS intégrées à AD, inscription des enregistrements
 * du contrôleur, redémarrage.
 */
import type { Draft } from 'immer'
import { logEvent } from '../../core/eventlog'
import { transact } from '../../core/result'
import type { AdComputer, Domain, LabState, ServerDevice } from '../../model/schema'
import { effectiveIpv4 } from '../../net/addressing'
import { concatTraces, type PacketTrace } from '../../sim/trace'
import { applyRestart } from '../../services/system'
import { normalizeName } from '../dns/server'
import { DNS_STATE, dnsServerOf } from '../dns/state'
import { ensureRoleState } from '../state'
import { AD_GROUPS, findPrincipal, isDomainAdmin, newAdId, passwordMeetsPolicy } from './directory'
import { accountName, type DirectoryOperation } from './join'
import { exchange, locateDc } from './locator'
import { addressOf, dcRecords, dcSite, domainZones, siteOfAddress } from './sites'

export interface DomainControllerInput {
  domainName: string
  /** Compte d'un administrateur du domaine (LAB\Administrateur). */
  user: string
  password: string
  safeModePassword: string
  /** Site choisi ; absent : site du sous-réseau du serveur, sinon celui du DC source. */
  site?: string | null
  installDns?: boolean
}

export type DomainControllerOutcome = DirectoryOperation & { site: string | null }

export function installDomainController(
  state: LabState,
  deviceId: string,
  input: DomainControllerInput
): DomainControllerOutcome {
  const device = state.devices[deviceId]
  const traces: PacketTrace[] = []
  const domainName = normalizeName(input.domainName)
  const fail = (message: string): DomainControllerOutcome => ({
    state,
    trace: concatTraces(`Promotion de ${device?.name ?? ''}`, traces),
    ok: false,
    message,
    site: null
  })
  if (!device || device.kind !== 'server' || !device.powered)
    return fail('Seul un serveur allumé peut devenir contrôleur de domaine.')
  if (!device.host.features.includes('AD-Domain-Services'))
    return fail(
      'Le rôle Services AD DS doit être installé avant la promotion (Install-WindowsFeature AD-Domain-Services).'
    )
  if (Object.values(state.domains).some((d) => d.controllers.includes(deviceId)))
    return fail('Ce serveur est déjà contrôleur de domaine.')
  if (device.host.domain && device.host.domain !== domainName)
    return fail(
      `Ce serveur est membre du domaine ${device.host.domain} : il ne peut pas devenir contrôleur de ${domainName}.`
    )
  if (!passwordMeetsPolicy(input.safeModePassword))
    return fail(
      'Le mot de passe du mode de restauration des services d’annuaire ne répond pas aux exigences : au moins 7 caractères et trois catégories (majuscules, minuscules, chiffres, symboles).'
    )

  const located = locateDc(state, deviceId, domainName, traces)
  if (!located)
    return fail(
      `Impossible de contacter un contrôleur de domaine Active Directory pour le domaine « ${domainName} » : vérifiez que le serveur DNS de cet ordinateur résout le domaine.`
    )
  const domain = located.domain
  const sam = accountName(input.user)
  const principal = findPrincipal(domain, sam)
  const user = principal?.kind === 'user' ? principal.obj : null
  const good = !!user && user.enabled && user.password === input.password
  const kerberos = exchange(
    state,
    deviceId,
    located.dcIp,
    'KERBEROS',
    88,
    `Kerberos AS-REQ (${domain.netbios}\\${sam})`,
    good ? 'Kerberos AS-REP (ticket accordé)' : 'Kerberos KRB-ERROR (pré-authentification refusée)',
    [['Compte', `${sam}@${domain.name.toUpperCase()}`]]
  )
  traces.push(kerberos.trace)
  if (!good) return fail('Nom d’utilisateur ou mot de passe incorrect.')
  if (!isDomainAdmin(domain, user.sam))
    return fail(
      `Le compte ${domain.netbios}\\${user.sam} n’est pas membre du groupe Admins du domaine : il ne peut pas ajouter de contrôleur.`
    )

  const ip = addressOf(state, deviceId)
  let site = (ip && siteOfAddress(domain, ip)) || dcSite(domain, located.dcId)
  if (input.site) {
    const chosen = domain.sites.find((s) => s.name.toLowerCase() === input.site?.trim().toLowerCase())
    if (!chosen) return fail(`Le site « ${input.site} » est introuvable.`)
    site = chosen.name
  }

  const r = transact(state, (draft) => {
    const d = draft.domains[domain.name] as Draft<Domain>
    const server = draft.devices[deviceId] as Draft<ServerDevice>
    const dcOu = d.containers.find((c) => c.name === 'Domain Controllers' && c.parentId === null)
    let computer = d.computers.find((c) => c.name.toLowerCase() === server.name.toLowerCase()) as
      Draft<AdComputer> | undefined
    if (!computer) {
      computer = {
        id: newAdId(draft),
        name: server.name,
        parentId: dcOu?.id ?? '',
        deviceId,
        enabled: true,
        dnsHostName: `${server.name.toLowerCase()}.${d.name}`
      }
      d.computers.push(computer)
    }
    computer.deviceId = deviceId
    computer.enabled = true
    if (dcOu) computer.parentId = dcOu.id
    // Groupe principal d'un contrôleur : Contrôleurs de domaine (et non Ordinateurs du domaine)
    const id = computer.id
    for (const g of d.groups) {
      if (g.name === AD_GROUPS.domainComputers) g.members = g.members.filter((m) => m !== id)
      if (g.name === AD_GROUPS.domainControllers && !g.members.includes(id)) g.members.push(id)
    }
    server.host.domain = d.name
    server.host.workgroup = d.netbios
    server.host.pendingDomain = null
    d.controllers.push(deviceId)
    d.dcSites[deviceId] = site

    const address = ip ?? '127.0.0.1'
    if (input.installDns ?? true) {
      for (const f of ['DNS', 'RSAT-DNS-Server'])
        if (!server.host.features.includes(f)) server.host.features.push(f)
      const dns = ensureRoleState(server, DNS_STATE)
      // Zones intégrées à Active Directory : copiées depuis le contrôleur source
      const source = dnsServerOf(draft.devices[located.dcId])
      for (const zone of source?.zones ?? [])
        if (zone.adIntegrated && !dns.zones.some((z) => z.name === zone.name))
          dns.zones.push(JSON.parse(JSON.stringify(zone)) as typeof zone)
      const iface = server.interfaces.find((i) => effectiveIpv4(i)?.source === 'static')
      if (iface) {
        iface.dnsMode = 'static'
        iface.dnsServers = [located.dcIp, '127.0.0.1']
      }
      for (const { zone } of domainZones(draft, d))
        if (
          !zone.records.some((x) => x.type === 'NS' && x.data === `${server.name.toLowerCase()}.${d.name}.`)
        )
          zone.records.push({
            name: '@',
            type: 'NS',
            data: `${server.name.toLowerCase()}.${d.name}.`,
            ttl: 3600,
            dynamic: false
          })
    }
    // Inscription des enregistrements du contrôleur (Netlogon)
    for (const { zone } of domainZones(draft, d))
      for (const record of dcRecords(server.name, d.name, address, site))
        if (
          !zone.records.some(
            (x) => x.name === record.name && x.type === record.type && x.data === record.data
          )
        )
          zone.records.push(record)

    logEvent(draft, deviceId, {
      level: 'information',
      source: 'ActiveDirectory_DomainService',
      eventId: 1000,
      log: 'Service d’annuaire',
      message: `Le démarrage des services de domaine Active Directory est terminé. Ce serveur est contrôleur supplémentaire du domaine ${d.name} (site ${site}).`
    })
    server.host.session = { user: 'Administrateur', domain: d.netbios, logonServer: server.name }
    applyRestart(draft, server)
    server.host.session = { user: 'Administrateur', domain: d.netbios, logonServer: server.name }
    return undefined
  })
  if (!r.ok) return fail(r.error.message)
  return {
    state: r.state,
    trace: concatTraces(`Promotion de ${device.name} en contrôleur de ${domain.name}`, traces),
    ok: true,
    message: `L’ordinateur ${device.name} est désormais contrôleur du domaine ${domain.name} (site ${site}).`,
    site
  }
}
