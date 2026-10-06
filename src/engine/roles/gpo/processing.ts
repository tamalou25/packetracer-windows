/**
 * Traitement des stratégies de groupe sur un ordinateur membre du domaine :
 * au démarrage (traitement en arrière-plan), à l'ouverture de session et avec gpupdate.
 * Le client localise un contrôleur (DNS), lit les liaisons des GPO (LDAP), télécharge les
 * paramètres depuis SYSVOL (SMB) puis calcule le jeu de stratégie résultant.
 */
import type { Draft } from 'immer'
import { logEvent } from '../../core/eventlog'
import { transact } from '../../core/result'
import type {
  AppliedGpo,
  ComputerPolicyResult,
  Domain,
  FilteredGpo,
  HostDevice,
  LabState,
  UserPolicyResult
} from '../../model/schema'
import { concatTraces, type PacketTrace } from '../../sim/trace'
import { domainDn, objectDn } from '../adds/directory'
import { locateDc, serverExchange, type LocatedDc } from '../adds/locator'
import { roleModules } from '../registry'
import { computerRsop, userRsop, type Rsop, type RsopEntry, type RsopFiltered } from './scope'

/** Issue du traitement d'une partie (null = partie non demandée). */
export type PartOutcome = 'ok' | 'failed' | null

export interface PolicyProcessing {
  state: LabState
  trace: PacketTrace
  computer: PartOutcome
  user: PartOutcome
  /** Cause de l'échec (affichée par gpupdate). */
  error: string | null
}

export interface ProcessOptions {
  computer: boolean
  user: boolean
  /** Contrôleur déjà localisé (ouverture de session) : pas de nouvelle recherche DNS. */
  dc?: LocatedDc
}

export const GP_SOURCE = 'GroupPolicy'

/** Message d'échec du traitement (événement 1129 et sortie de gpupdate). */
export const GP_NO_DC_MESSAGE =
  'Le traitement de la stratégie de groupe a échoué, car aucune connectivité réseau vers un contrôleur de domaine n’est disponible. Cela peut être temporaire. Un message de réussite sera généré dès que l’ordinateur sera connecté au contrôleur de domaine et que la stratégie de groupe aura été traitée avec succès. Si aucun message de réussite n’est généré pour plusieurs heures, contactez votre administrateur.'

function hostOf(state: LabState, id: string): HostDevice | null {
  const d = state.devices[id]
  return d && (d.kind === 'server' || d.kind === 'client') ? d : null
}

/** Compte de la session ouverte (LAB\jdupont, PC1\Administrateur) ou null. */
export function sessionAccount(host: HostDevice): string | null {
  const s = host.host.session
  return s ? `${s.domain ?? host.name}\\${s.user}` : null
}

/** La stratégie d'ordinateur doit-elle être (re)traitée depuis le dernier démarrage ? */
export function computerPolicyStale(host: HostDevice): boolean {
  if (!host.host.domain) return false
  const computer = host.host.policy.computer
  return !computer || computer.boot !== host.host.bootedAt
}

/** La stratégie utilisateur de la session de domaine doit-elle être traitée ? */
export function userPolicyStale(host: HostDevice): boolean {
  const session = host.host.session
  if (!host.host.domain || !session?.domain) return false
  return host.host.policy.user?.account !== sessionAccount(host)
}

const toApplied = (e: RsopEntry): AppliedGpo => ({ id: e.gpo.id, name: e.gpo.name, location: e.location })
const toFiltered = (e: RsopFiltered): FilteredGpo => ({ ...toApplied(e), reason: e.reason })

/** Empreinte d'un résultat pour détecter un changement entre deux traitements. */
function fingerprint(result: { applied: AppliedGpo[]; settings: unknown } | null): string {
  return result ? JSON.stringify([result.applied.map((a) => a.id), result.settings]) : ''
}

/** Journalise le succès du traitement (1500/1501 sans changement, 1502/1503 sinon). */
function logSuccess(
  draft: Draft<LabState>,
  deviceId: string,
  part: 'computer' | 'user',
  rsop: Rsop<unknown>,
  changed: boolean
): void {
  const who = part === 'computer' ? 'l’ordinateur' : 'l’utilisateur'
  logEvent(draft, deviceId, {
    level: 'information',
    source: GP_SOURCE,
    eventId: (part === 'computer' ? 1500 : 1501) + (changed ? 2 : 0),
    message: changed
      ? `Les paramètres de stratégie de groupe pour ${who} ont été traités avec succès. De nouveaux paramètres de ${rsop.applied.length} objet(s) de stratégie de groupe ont été détectés et appliqués.`
      : `Les paramètres de stratégie de groupe pour ${who} ont été traités avec succès. Aucune modification n’a été détectée depuis le dernier traitement réussi de la stratégie de groupe.`
  })
}

/**
 * Traite la stratégie d'ordinateur et/ou la stratégie utilisateur de la session.
 * Hors domaine, seule la stratégie locale (vide) s'applique : le traitement réussit sans échange.
 */
export function processGroupPolicy(
  state: LabState,
  deviceId: string,
  options: ProcessOptions
): PolicyProcessing {
  const host = hostOf(state, deviceId)
  const asked = (wanted: boolean, outcome: 'ok' | 'failed'): PartOutcome => (wanted ? outcome : null)
  const empty: PacketTrace = { title: 'Stratégie de groupe', events: [] }
  if (!host || !host.powered)
    return {
      state,
      trace: empty,
      computer: asked(options.computer, 'failed'),
      user: asked(options.user, 'failed'),
      error: 'L’ordinateur est éteint.'
    }
  if (!host.host.domain)
    return {
      state,
      trace: empty,
      computer: asked(options.computer, 'ok'),
      user: asked(options.user, 'ok'),
      error: null
    }

  const traces: PacketTrace[] = []
  const located = options.dc ?? locateDc(state, deviceId, host.host.domain, traces)
  const title = `Stratégie de groupe ${host.name}`
  if (!located) {
    const r = transact(state, (draft) => {
      logEvent(draft, deviceId, {
        level: 'error',
        source: GP_SOURCE,
        eventId: 1129,
        message: GP_NO_DC_MESSAGE
      })
      return undefined
    })
    return {
      state: r.ok ? r.state : state,
      trace: concatTraces(title, traces),
      computer: asked(options.computer, 'failed'),
      user: asked(options.user, 'failed'),
      error: GP_NO_DC_MESSAGE
    }
  }

  const domain: Domain = located.domain
  const dc = state.devices[located.dcId]
  const source = dc ? `${dc.name.toLowerCase()}.${domain.name}` : domain.name
  const computerObj = domain.computers.find((c) => c.deviceId === deviceId)
  const session = host.host.session
  const userObj =
    session?.domain && session.domain.toUpperCase() === domain.netbios.toUpperCase()
      ? domain.users.find((u) => u.sam.toLowerCase() === session.user.toLowerCase())
      : undefined

  const computer = options.computer && computerObj ? computerRsop(domain, computerObj) : null
  const user = options.user && userObj ? userRsop(domain, userObj) : null
  const count = (computer?.applied.length ?? 0) + (user?.applied.length ?? 0)

  // LDAP : lecture des liaisons (gPLink) ; SMB : lecture des paramètres dans SYSVOL
  const ldap = serverExchange(state, deviceId, located.dcIp, {
    protocol: 'LDAP',
    port: 389,
    request: 'LDAP : recherche des objets de stratégie de groupe (gPLink, gPOptions)',
    reply: `LDAP : ${count} objet(s) de stratégie de groupe dans l’étendue`,
    fields: [['Base', domainDn(domain)]]
  })
  traces.push(ldap.trace)
  const smb = serverExchange(state, deviceId, located.dcIp, {
    protocol: 'SMB',
    port: 445,
    request: `SMB2 : lecture de \\\\${domain.name}\\SYSVOL\\${domain.name}\\Policies`,
    reply: 'SMB2 : contenu de GPT.INI et des paramètres',
    fields: [['Partage', `\\\\${domain.name}\\SYSVOL`]]
  })
  traces.push(smb.trace)
  const trace = concatTraces(title, traces)
  if (!ldap.ok || !smb.ok)
    return {
      state,
      trace,
      computer: asked(options.computer, 'failed'),
      user: asked(options.user, 'failed'),
      error: GP_NO_DC_MESSAGE
    }

  const r = transact(state, (draft) => {
    const device = draft.devices[deviceId] as Draft<HostDevice>
    const policy = device.host.policy
    if (computer && computerObj) {
      const result: ComputerPolicyResult = {
        time: draft.clock,
        source,
        dn: objectDn(domain, { kind: 'computer', obj: computerObj }),
        applied: computer.applied.map(toApplied),
        filtered: computer.filtered.map(toFiltered),
        boot: device.host.bootedAt,
        settings: computer.settings
      }
      const changed = fingerprint(policy.computer) !== fingerprint(result)
      policy.computer = result
      logSuccess(draft, deviceId, 'computer', computer, changed)
      // Extensions côté client des autres rôles (certificats…)
      for (const module of roleModules()) module.onComputerPolicy?.(draft, deviceId, domain)
    }
    if (options.user) {
      if (user && userObj) {
        const result: UserPolicyResult = {
          time: draft.clock,
          source,
          dn: objectDn(domain, { kind: 'user', obj: userObj }),
          applied: user.applied.map(toApplied),
          filtered: user.filtered.map(toFiltered),
          account: `${domain.netbios}\\${userObj.sam}`,
          settings: user.settings
        }
        const changed = fingerprint(policy.user) !== fingerprint(result)
        policy.user = result
        logSuccess(draft, deviceId, 'user', user, changed)
      } else {
        // Session locale : seule la stratégie locale (vide) s'applique
        policy.user = null
      }
    }
    return undefined
  })
  const missingComputer = options.computer && !computerObj
  return {
    state: r.ok ? r.state : state,
    trace,
    computer: options.computer ? (computerObj ? 'ok' : 'failed') : null,
    user: asked(options.user, 'ok'),
    error: missingComputer
      ? `Le compte d’ordinateur de ${host.name} est introuvable dans le domaine ${domain.name} : la relation d’approbation entre cette station de travail et le domaine a échoué.`
      : null
  }
}

/**
 * Traitement en arrière-plan : après un démarrage (ou une ouverture de session conservée),
 * les membres du domaine appliquent leurs stratégies dès que le réseau le permet.
 * Une seule tentative par démarrage et par session : en cas d'échec, gpupdate ou une
 * nouvelle ouverture de session relancent le traitement.
 */
export function autoGroupPolicy(state: LabState): { state: LabState; traces: PacketTrace[] } {
  let current = state
  const traces: PacketTrace[] = []
  for (const device of Object.values(state.devices)) {
    if ((device.kind !== 'server' && device.kind !== 'client') || !device.powered || !device.host.domain)
      continue
    const computer = computerPolicyStale(device)
    const user = userPolicyStale(device)
    if (!computer && !user) continue
    const key = `${device.host.bootedAt}|${sessionAccount(device) ?? ''}`
    if (device.host.policy.attempt === key) continue
    const result = processGroupPolicy(current, device.id, { computer, user })
    const marked = transact(result.state, (draft) => {
      const d = draft.devices[device.id] as Draft<HostDevice>
      d.host.policy.attempt = key
      return undefined
    })
    current = marked.ok ? marked.state : result.state
    if (result.trace.events.length > 0) traces.push(result.trace)
  }
  return { state: current, traces }
}
