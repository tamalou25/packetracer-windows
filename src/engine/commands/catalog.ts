/**
 * Catalogue des commandes : toute modification de l'état du lab demandée par l'interface, les
 * consoles ou les labs est une commande nommée `{ type, args }`, sérialisable et rejouable.
 * Chaque commande réutilise telle quelle une action du moteur et fournit un libellé en français
 * (journal, menu « Annuler : … »).
 *
 * Commandes du système de base ici ; celles d'un rôle sont déclarées par son module
 * (`roles/<rôle>/commands.ts`) et rassemblées par le registre.
 */
import { clearEventLog } from '../core/eventlog'
import type { EngineResult } from '../core/result'
import { nextDeviceName } from '../model/factory'
import type { LabState, Position } from '../model/schema'
import { addStaticRoute, removeStaticRoute, setInterfaceIpv4 } from '../net/config'
import {
  addSubinterface,
  addVlan,
  removeSubinterface,
  removeVlan,
  renameVlan,
  setSwitchport
} from '../net/vlan'
import { backgroundLabel, runBackgroundTasks } from '../roles/background'
import { installFeatures, uninstallFeatures } from '../roles/features'
import { roleModules, type RoleModules } from '../roles/registry'
import { newSelfSignedCertificate } from '../services/certificates'
import { renameComputer, restartComputer } from '../services/system'
import { executeLine } from '../shell/exec'
import type { ShellResult, ShellSession } from '../shell/types'
import type { PacketTrace } from '../sim/trace'
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
import { def, on, type AnyCommand, type CommandDef, type CommandDefs } from './define'
import { deviceName, deviceNames, interfaceName, linkName } from './labels'

export { def, type AnyCommand, type CommandDef, type CommandDefs } from './define'
export type { DirectoryOutcome } from '../roles/adds/commands'
export type { DhcpClientOutcome } from '../roles/dhcp/commands'

/** Déplacement de plusieurs équipements (fin d'un glisser sur le canvas). */
function moveDevices(state: LabState, moves: { id: string; position: Position }[]): EngineResult {
  let current = state
  for (const move of moves) {
    const result = moveDevice(current, move.id, move.position)
    if (!result.ok) return result
    current = result.state
  }
  return { ok: true, state: current, value: undefined }
}

/** Résultat d'une ligne de console (sans l'état, porté par EngineResult). */
export type ShellOutcome = Omit<ShellResult, 'state'>

// --- Lot de commandes ---------------------------------------------------------------------------

/** Exécute plusieurs commandes dans l'ordre ; la première erreur annule tout le lot. */
function runBatch(state: LabState, commands: AnyCommand[]): EngineResult<unknown[]> {
  let current = state
  const values: unknown[] = []
  for (const command of commands) {
    const entry = isCommandType(command.type) ? commandDefinitions()[command.type] : undefined
    if (!entry || command.type === 'batch')
      return { ok: false, error: { code: 'UnknownCommand', message: `Commande inconnue : ${command.type}.` } }
    const result = entry.run(current, ...command.args)
    if (!result.ok) return result
    current = result.state
    values.push(result.value)
  }
  return { ok: true, state: current, value: values }
}

/** Tâches de fond (mode Temps réel) déclarées par les modules de rôles. */
function backgroundTick(state: LabState): EngineResult<PacketTrace[]> {
  const { state: next, traces } = runBackgroundTasks(state)
  return { ok: true, state: next, value: traces }
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

// --- Catalogue ----------------------------------------------------------------------------------

/** Commandes du système de base (topologie, réseau, système, consoles, lots). */
const CORE_COMMANDS = {
  // Topologie
  // Sans nom imposé : le nom que l'équipement recevra (SRV1, PC2…)
  'topology.addDevice': def(addDevice, (s, p) => `Ajouter ${p.name?.trim() || nextDeviceName(s, p.kind)}`),
  'topology.removeDevices': def(removeDevices, (s, ids) => `Supprimer ${deviceNames(s, ids)}`),
  'topology.renameDevice': def(renameDevice, (s, id, name) => `Renommer ${deviceName(s, id)} en ${name}`),
  'topology.moveDevice': def(moveDevice, (s, id) => `Déplacer ${deviceName(s, id)}`),
  'topology.moveDevices': def(
    moveDevices,
    (s, moves) =>
      `Déplacer ${deviceNames(
        s,
        moves.map((m) => m.id)
      )}`
  ),
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
  'net.addVlan': def(addVlan, (s, id, vlan) => `Créer le VLAN ${vlan}${on(s, id)}`),
  'net.renameVlan': def(renameVlan, (s, id, vlan, name) => `Renommer le VLAN ${vlan} en ${name}${on(s, id)}`),
  'net.removeVlan': def(removeVlan, (s, id, vlan) => `Supprimer le VLAN ${vlan}${on(s, id)}`),
  'net.setSwitchport': def(setSwitchport, (s, id, ifaceId, input) =>
    input.mode === 'trunk'
      ? `Configurer ${interfaceName(s, id, ifaceId)} en trunk 802.1Q`
      : `Affecter ${interfaceName(s, id, ifaceId)} au VLAN ${input.accessVlan ?? 1}`
  ),
  'net.addSubinterface': def(
    addSubinterface,
    (s, id, parentId, vlan) => `Créer la sous-interface ${interfaceName(s, id, parentId)}.${vlan}`
  ),
  'net.removeSubinterface': def(
    removeSubinterface,
    (s, id, ifaceId) => `Supprimer la sous-interface ${interfaceName(s, id, ifaceId)}`
  ),

  // Système
  'system.restartComputer': def(restartComputer, (s, id) => `Redémarrer ${deviceName(s, id)}`),
  'system.renameComputer': def(
    renameComputer,
    (s, id, name) => `Renommer l’ordinateur ${deviceName(s, id)} en ${name}`
  ),
  'system.clearEventLog': def(clearEventLog, (s, id, log) => `Effacer le journal ${log}${on(s, id)}`),
  'system.newSelfSignedCertificate': def(
    newSelfSignedCertificate,
    (s, id, names) => `Créer un certificat auto-signé pour ${names.join(', ')}${on(s, id)}`
  ),
  'system.installFeatures': def(
    installFeatures,
    (s, id, names) => `Installer ${names.join(', ')}${on(s, id)}`
  ),
  'system.uninstallFeatures': def(
    uninstallFeatures,
    (s, id, names) => `Supprimer ${names.join(', ')}${on(s, id)}`
  ),

  // Consoles, tâches de fond, lots
  'shell.exec': def(shellExec, (s, session, line) => `${line}${on(s, session.deviceId)}`),
  'background.tick': def(backgroundTick, () => backgroundLabel()),
  batch: def(runBatch, (_s, commands) => `${commands.length} opération(s)`)
}

type UnionToIntersection<U> = (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void
  ? I
  : never

/** Commandes de tous les modules de rôles (type exact, dérivé du registre). */
type RoleCommands = UnionToIntersection<RoleModules[number]['commands']>
type Commands = typeof CORE_COMMANDS & RoleCommands

let commands: CommandDefs | null = null

/** Toutes les commandes : système de base + modules de rôles (construit à la première lecture). */
export function commandDefinitions(): CommandDefs {
  return (commands ??= Object.assign({}, CORE_COMMANDS, ...roleModules().map((m) => m.commands)))
}

export type CommandType = keyof Commands & string
type DefOf<K extends CommandType> = Commands[K]
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
  return Object.prototype.hasOwnProperty.call(commandDefinitions(), type)
}
