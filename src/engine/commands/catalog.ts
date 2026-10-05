/**
 * Catalogue des commandes : toute modification de l'état du lab demandée par l'interface, les
 * consoles ou les labs est une commande nommée `{ type, args }`, sérialisable et rejouable.
 * Chaque commande réutilise telle quelle une action du moteur et fournit un libellé en français
 * (journal, futur menu « Annuler : … »).
 */
import { fail, type EngineResult } from '../core/result'
import { clearEventLog } from '../core/eventlog'
import type { LabState } from '../model/schema'
import { addStaticRoute, removeStaticRoute, setInterfaceIpv4 } from '../net/config'
import type { PacketTrace } from '../sim/trace'
import {
  addGroup,
  addGroupMembers,
  addOrganizationalUnit,
  addUser,
  moveObject,
  removeGroupMembers,
  removeObject,
  resetPassword,
  setAccountEnabled
} from '../services/adds/objects'
import { installForest } from '../services/adds/forest'
import {
  changePasswordAndLogon,
  joinDomain,
  leaveDomain,
  logoff,
  logon,
  type DirectoryOperation,
  type LogonOutcome
} from '../services/adds/join'
import { autoConfigureDhcp } from '../services/dhcp-client'
import { authorizeDhcpServer, completeDhcpPostInstall } from '../services/dhcp-authorization'
import {
  addExclusion,
  addReservation,
  addScope,
  removeExclusion,
  removeReservation,
  removeScope,
  setDhcpOptions,
  setScopeState
} from '../services/dhcp'
import { addPrimaryZone, addRecord, removeRecord, removeZone, setForwarders } from '../services/dns'
import { installFeatures, uninstallFeatures } from '../services/features'
import {
  createItem,
  createShare,
  removeItem,
  removeNtfs,
  removeShare,
  setNtfsEntry,
  setNtfsInheritance,
  setShareAcl
} from '../services/files/actions'
import type { AccessToken } from '../services/files/acl'
import { mapDrive, unmapDrive, type DriveOperation } from '../services/files/smb'
import { autoGroupPolicy } from '../services/gpo/processing'
import {
  createGpo,
  deleteGpo,
  linkGpo,
  renameGpo,
  setGpoSecurityFilter,
  setGpoStatus,
  setInheritanceBlocked,
  unlinkGpo,
  updateGpoLink,
  updateGpoSettings
} from '../services/gpo/objects'
import { renameComputer, restartComputer } from '../services/system'
import { executeLine } from '../shell/exec'
import type { ShellResult, ShellSession } from '../shell/types'
import {
  addDevice,
  addServerInterface,
  connect,
  disconnect,
  duplicateDevices,
  moveDevice,
  removeDevices,
  renameDevice,
  setInterfaceEnabled,
  setPower
} from '../topology/actions'
import {
  deviceName,
  deviceNames,
  directoryObjectName,
  gpoName,
  interfaceName,
  linkName,
  linkTargetName,
  scopeName
} from './labels'

/** Définition d'une commande : action du moteur et libellé. */
export interface CommandDef<A extends unknown[], T> {
  run: (state: LabState, ...args: A) => EngineResult<T>
  label: (state: LabState, ...args: A) => string
}

function def<A extends unknown[], T>(
  run: (state: LabState, ...args: A) => EngineResult<T>,
  label: (state: LabState, ...args: A) => string
): CommandDef<A, T> {
  return { run, label }
}

/** Commande sans typage précis (sous-commandes d'un lot, commandes relues d'un fichier). */
export interface AnyCommand {
  type: string
  args: unknown[]
}

// --- Adaptateurs : actions dont le résultat n'a pas la forme EngineResult -----------------------

/** Résultat métier d'une opération d'annuaire (jonction, ouverture de session…). */
export interface DirectoryOutcome {
  /** L'opération a abouti (un échec est aussi journalisé : évènement 4625, trace réseau). */
  success: boolean
  message: string
  trace: PacketTrace
  mustChangePassword: boolean
}

/** Une opération d'annuaire modifie l'état même en cas d'échec (journal de sécurité, trace). */
function directory(op: DirectoryOperation | LogonOutcome): EngineResult<DirectoryOutcome> {
  return {
    ok: true,
    state: op.state,
    value: {
      success: op.ok,
      message: op.message,
      trace: op.trace,
      mustChangePassword: 'mustChangePassword' in op ? op.mustChangePassword === true : false
    }
  }
}

/** Lecteur réseau : un échec (erreur système 53, 67, 5…) ne modifie pas l'état. */
function drive(op: DriveOperation): EngineResult<{ trace: PacketTrace }> {
  if (!op.ok) return { ok: false, error: { code: `SystemError${op.code}`, message: op.message } }
  return { ok: true, state: op.state, value: { trace: op.trace } }
}

/** Résultat d'une ligne de console (sans l'état, porté par EngineResult). */
export type ShellOutcome = Omit<ShellResult, 'state'>

// --- Lot de commandes ---------------------------------------------------------------------------

/** Exécute plusieurs commandes dans l'ordre ; la première erreur annule tout le lot. */
function runBatch(state: LabState, commands: AnyCommand[]): EngineResult<unknown[]> {
  let current = state
  const values: unknown[] = []
  for (const command of commands) {
    const entry = (COMMANDS as Record<string, CommandDef<unknown[], unknown>>)[command.type]
    if (!entry || command.type === 'batch')
      return { ok: false, error: { code: 'UnknownCommand', message: `Commande inconnue : ${command.type}.` } }
    const result = entry.run(current, ...command.args)
    if (!result.ok) return result
    current = result.state
    values.push(result.value)
  }
  return { ok: true, state: current, value: values }
}

/** Tâches de fond (mode Temps réel) : baux DHCP puis stratégies de groupe après un démarrage. */
function backgroundTick(state: LabState): EngineResult<PacketTrace[]> {
  const dhcp = autoConfigureDhcp(state)
  const policy = autoGroupPolicy(dhcp.state)
  return { ok: true, state: policy.state, value: [...dhcp.traces, ...policy.traces] }
}

/** Fermeture de session (l'action renvoie directement l'état). */
function closeSession(state: LabState, deviceId: string): EngineResult {
  if (!state.devices[deviceId]) return fail('DeviceNotFound', 'Équipement introuvable.')
  return { ok: true, state: logoff(state, deviceId), value: undefined }
}

function shellExec(
  state: LabState,
  session: ShellSession,
  line: string,
  answers: string[]
): EngineResult<ShellOutcome> {
  const { state: next, ...outcome } = executeLine(state, session, line, answers)
  return { ok: true, state: next, value: outcome }
}

const on = (s: LabState, id: string) => ` sur ${deviceName(s, id)}`
const yesNo = (value: boolean, yes: string, no: string) => (value ? yes : no)

// --- Catalogue ----------------------------------------------------------------------------------

export const COMMANDS = {
  // Topologie
  'topology.addDevice': def(addDevice, (_s, p) => `Ajouter ${p.name ?? `un équipement (${p.kind})`}`),
  'topology.removeDevices': def(removeDevices, (s, ids) => `Supprimer ${deviceNames(s, ids)}`),
  'topology.renameDevice': def(renameDevice, (s, id, name) => `Renommer ${deviceName(s, id)} en ${name}`),
  'topology.moveDevice': def(moveDevice, (s, id) => `Déplacer ${deviceName(s, id)}`),
  'topology.setPower': def(setPower, (s, id, on) => `${on ? 'Allumer' : 'Éteindre'} ${deviceName(s, id)}`),
  'topology.connect': def(
    connect,
    (s, a, b) =>
      `Câbler ${interfaceName(s, a.deviceId, a.ifaceId)} ↔ ${interfaceName(s, b.deviceId, b.ifaceId)}`
  ),
  'topology.disconnect': def(disconnect, (s, linkId) => `Débrancher ${linkName(s, linkId)}`),
  'topology.duplicateDevices': def(
    duplicateDevices,
    (_s, source) => `Coller ${source.devices.length} équipement(s)`
  ),
  'topology.addServerInterface': def(addServerInterface, (s, id) => `Ajouter une carte réseau${on(s, id)}`),

  // Réseau
  'net.setInterfaceEnabled': def(
    setInterfaceEnabled,
    (s, id, ifaceId, enabled) => `${enabled ? 'Activer' : 'Désactiver'} ${interfaceName(s, id, ifaceId)}`
  ),
  'net.setInterfaceIpv4': def(
    setInterfaceIpv4,
    (s, id, ifaceId) => `Configurer IPv4 de ${interfaceName(s, id, ifaceId)}`
  ),
  'net.addStaticRoute': def(
    addStaticRoute,
    (s, id, r) => `Ajouter la route ${r.network}/${r.mask}${on(s, id)}`
  ),
  'net.removeStaticRoute': def(removeStaticRoute, (s, id) => `Supprimer une route statique${on(s, id)}`),

  // Système
  'system.restartComputer': def(restartComputer, (s, id) => `Redémarrer ${deviceName(s, id)}`),
  'system.renameComputer': def(
    renameComputer,
    (s, id, name) => `Renommer l’ordinateur ${deviceName(s, id)} en ${name}`
  ),
  'system.clearEventLog': def(clearEventLog, (s, id, log) => `Effacer le journal ${log}${on(s, id)}`),
  'system.installFeatures': def(
    installFeatures,
    (s, id, names) => `Installer ${names.join(', ')}${on(s, id)}`
  ),
  'system.uninstallFeatures': def(
    uninstallFeatures,
    (s, id, names) => `Supprimer ${names.join(', ')}${on(s, id)}`
  ),

  // DHCP
  'dhcp.completePostInstall': def(
    completeDhcpPostInstall,
    (s, id) => `Terminer la configuration DHCP${on(s, id)}`
  ),
  'dhcp.authorize': def(
    authorizeDhcpServer,
    (s, id, authorized) =>
      `${yesNo(authorized, 'Autoriser', 'Retirer l’autorisation de')} ${deviceName(s, id)} dans AD`
  ),
  'dhcp.addScope': def(addScope, (s, id, input) => `Créer l’étendue ${input.name}${on(s, id)}`),
  'dhcp.removeScope': def(
    removeScope,
    (s, id, scopeId) => `Supprimer l’étendue ${scopeName(s, id, scopeId)}`
  ),
  'dhcp.setScopeState': def(
    setScopeState,
    (s, id, scopeId, active) => `${active ? 'Activer' : 'Désactiver'} l’étendue ${scopeName(s, id, scopeId)}`
  ),
  'dhcp.addExclusion': def(
    addExclusion,
    (s, id, scopeId, start, end) => `Exclure ${start}–${end} de ${scopeName(s, id, scopeId)}`
  ),
  'dhcp.removeExclusion': def(
    removeExclusion,
    (s, id, scopeId) => `Supprimer une exclusion de ${scopeName(s, id, scopeId)}`
  ),
  'dhcp.addReservation': def(addReservation, (_s, _id, _scope, r) => `Réserver ${r.ip} pour ${r.name}`),
  'dhcp.removeReservation': def(
    removeReservation,
    (_s, _id, _scope, key) => `Supprimer la réservation ${key}`
  ),
  'dhcp.setOptions': def(
    setDhcpOptions,
    (s, id, scopeId) =>
      `Modifier les options DHCP ${scopeId ? `de ${scopeName(s, id, scopeId)}` : `du serveur${on(s, id)}`}`
  ),

  // DNS
  'dns.addPrimaryZone': def(
    addPrimaryZone,
    (s, id, z) => `Créer la zone ${z.name ?? z.networkId ?? ''}${on(s, id)}`
  ),
  'dns.removeZone': def(removeZone, (s, id, zone) => `Supprimer la zone ${zone}${on(s, id)}`),
  'dns.addRecord': def(
    addRecord,
    (_s, _id, zone, r) => `Ajouter l’enregistrement ${r.type} ${r.name} dans ${zone}`
  ),
  'dns.removeRecord': def(
    removeRecord,
    (_s, _id, zone, name, type) => `Supprimer l’enregistrement ${type} ${name} de ${zone}`
  ),
  'dns.setForwarders': def(setForwarders, (s, id) => `Modifier les redirecteurs${on(s, id)}`),

  // Active Directory
  'adds.installForest': def(
    installForest,
    (s, id, f) => `Promouvoir ${deviceName(s, id)} (forêt ${f.domainName})`
  ),
  'adds.addOrganizationalUnit': def(
    addOrganizationalUnit,
    (_s, _d, ou) => `Créer l’unité d’organisation ${ou.name}`
  ),
  'adds.addUser': def(addUser, (_s, _d, u) => `Créer l’utilisateur ${u.name}`),
  'adds.addGroup': def(addGroup, (_s, _d, g) => `Créer le groupe ${g.name}`),
  'adds.addGroupMembers': def(addGroupMembers, (_s, _d, group) => `Ajouter des membres au groupe ${group}`),
  'adds.removeGroupMembers': def(
    removeGroupMembers,
    (_s, _d, group) => `Retirer des membres du groupe ${group}`
  ),
  'adds.moveObject': def(moveObject, (s, d, id) => `Déplacer ${directoryObjectName(s, d, id)}`),
  'adds.removeObject': def(removeObject, (s, d, id) => `Supprimer ${directoryObjectName(s, d, id)}`),
  'adds.setAccountEnabled': def(
    setAccountEnabled,
    (_s, _d, identity, enabled) => `${enabled ? 'Activer' : 'Désactiver'} le compte ${identity}`
  ),
  'adds.resetPassword': def(
    resetPassword,
    (_s, _d, identity) => `Réinitialiser le mot de passe de ${identity}`
  ),
  'adds.joinDomain': def(
    (s: LabState, id: string, input: Parameters<typeof joinDomain>[2]) => directory(joinDomain(s, id, input)),
    (s, id, input) => `Joindre ${deviceName(s, id)} au domaine ${input.domain}`
  ),
  'adds.leaveDomain': def(
    (s: LabState, id: string) => directory(leaveDomain(s, id)),
    (s, id) => `Retirer ${deviceName(s, id)} du domaine`
  ),
  'adds.logon': def(
    (s: LabState, id: string, input: Parameters<typeof logon>[2]) => directory(logon(s, id, input)),
    (s, id, input) => `Ouvrir une session ${input.user}${on(s, id)}`
  ),
  'adds.changePasswordAndLogon': def(
    (s: LabState, id: string, input: Parameters<typeof changePasswordAndLogon>[2]) =>
      directory(changePasswordAndLogon(s, id, input)),
    (s, id, input) => `Changer le mot de passe de ${input.user}${on(s, id)}`
  ),
  'adds.logoff': def(closeSession, (s, id) => `Fermer la session${on(s, id)}`),

  // Stratégies de groupe
  'gpo.create': def(createGpo, (_s, _d, input) => `Créer la GPO ${input.name}`),
  'gpo.delete': def(deleteGpo, (s, d, id) => `Supprimer la GPO ${gpoName(s, d, id)}`),
  'gpo.rename': def(renameGpo, (s, d, id, name) => `Renommer la GPO ${gpoName(s, d, id)} en ${name}`),
  'gpo.setStatus': def(setGpoStatus, (s, d, id) => `Modifier l’état de la GPO ${gpoName(s, d, id)}`),
  'gpo.link': def(
    linkGpo,
    (s, d, id, target) => `Lier ${gpoName(s, d, id)} à ${linkTargetName(s, d, target)}`
  ),
  'gpo.updateLink': def(
    updateGpoLink,
    (s, d, id, target) => `Modifier la liaison ${gpoName(s, d, id)} sur ${linkTargetName(s, d, target)}`
  ),
  'gpo.unlink': def(
    unlinkGpo,
    (s, d, id, target) => `Supprimer la liaison ${gpoName(s, d, id)} de ${linkTargetName(s, d, target)}`
  ),
  'gpo.setInheritanceBlocked': def(
    setInheritanceBlocked,
    (s, d, target, blocked) =>
      `${blocked ? 'Bloquer' : 'Rétablir'} l’héritage sur ${linkTargetName(s, d, target)}`
  ),
  'gpo.setSecurityFilter': def(
    setGpoSecurityFilter,
    (s, d, id, identity, apply) =>
      `${apply ? 'Ajouter' : 'Retirer'} ${identity} au filtrage de ${gpoName(s, d, id)}`
  ),
  'gpo.updateSettings': def(
    updateGpoSettings,
    (s, d, id) => `Modifier les paramètres de ${gpoName(s, d, id)}`
  ),

  // Fichiers et partages
  'files.createItem': def(
    createItem,
    (s, id, path, kind) => `Créer ${kind === 'folder' ? 'le dossier' : 'le fichier'} ${path}${on(s, id)}`
  ),
  'files.removeItem': def(removeItem, (s, id, path) => `Supprimer ${path}${on(s, id)}`),
  'files.createShare': def(
    createShare,
    (s, id, input) => `Partager ${input.path} sous ${input.name}${on(s, id)}`
  ),
  'files.removeShare': def(removeShare, (s, id, name) => `Arrêter le partage ${name}${on(s, id)}`),
  'files.setShareAcl': def(
    setShareAcl,
    (s, id, name) => `Modifier les autorisations du partage ${name}${on(s, id)}`
  ),
  'files.setNtfsEntry': def(
    setNtfsEntry,
    (_s, _id, path, principal) => `Modifier les autorisations de ${principal} sur ${path}`
  ),
  'files.removeNtfs': def(
    removeNtfs,
    (_s, _id, path, account) => `Retirer ${account} des autorisations de ${path}`
  ),
  'files.setNtfsInheritance': def(
    setNtfsInheritance,
    (_s, _id, path) => `Modifier l’héritage des autorisations de ${path}`
  ),
  'files.mapDrive': def(
    (
      s: LabState,
      id: string,
      letter: string,
      path: string,
      token: AccessToken | null,
      options: { persistent?: boolean } = {}
    ) => drive(mapDrive(s, id, letter, path, token, options)),
    (s, id, letter, path) => `Connecter ${letter}: à ${path}${on(s, id)}`
  ),
  'files.unmapDrive': def(
    (s: LabState, id: string, letter: string, account: string) => drive(unmapDrive(s, id, letter, account)),
    (s, id, letter) => `Déconnecter ${letter}:${on(s, id)}`
  ),

  // Consoles, tâches de fond, lots
  'shell.exec': def(shellExec, (s, session, line) => `${line}${on(s, session.deviceId)}`),
  'background.tick': def(backgroundTick, () => 'Tâches de fond (DHCP, stratégies de groupe)'),
  batch: def(runBatch, (_s, commands) => `${commands.length} opération(s)`)
}

export type CommandType = keyof typeof COMMANDS
type DefOf<K extends CommandType> = (typeof COMMANDS)[K]
export type CommandArgs<K extends CommandType> = DefOf<K> extends CommandDef<infer A, unknown> ? A : never
export type CommandValue<K extends CommandType> = DefOf<K> extends CommandDef<never, infer T> ? T : never

export interface Command<K extends CommandType = CommandType> {
  type: K
  args: CommandArgs<K>
  /** Libellé imposé (lots d'un assistant : « Créer le partage Compta »). */
  label?: string
}

/** Construit une commande typée : `command('dhcp.addScope', serverId, { name: 'LAN', … })`. */
export function command<K extends CommandType>(type: K, ...args: CommandArgs<K>): Command<K> {
  return { type, args }
}

/** Lot de commandes exécutées comme une seule (une entrée du journal, un seul « Annuler »). */
export function batch(label: string, commands: AnyCommand[]): Command<'batch'> {
  return { type: 'batch', args: [commands], label }
}

export function isCommandType(type: string): type is CommandType {
  return Object.prototype.hasOwnProperty.call(COMMANDS, type)
}
