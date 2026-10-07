/**
 * Rôles de maître d'opérations (FSMO) : détenteurs (netdom query fsmo), transfert vers un autre
 * contrôleur (Move-ADDirectoryServerOperationMasterRole) et prise de force (-Force) lorsque
 * l'ancien détenteur ne répond plus.
 */
import { raise, transact, type EngineResult } from '../../core/result'
import type { Domain, FsmoRole, LabState } from '../../model/schema'
import { FSMO_ROLES } from '../../model/schema'
import { serverExchange } from './locator'
import { requireDomain } from './objects'
import { addressOf } from './sites'

/** Libellés de netdom query fsmo (version française). */
export const FSMO_LABELS: Record<FsmoRole, string> = {
  SchemaMaster: 'Contrôleur de schéma',
  DomainNamingMaster: 'Maître d’attribution de noms de domaine',
  PDCEmulator: 'Contrôleur domaine principal',
  RIDMaster: 'Gestionnaire du pool RID',
  InfrastructureMaster: 'Maître d’infrastructure'
}

/** Valeurs numériques acceptées par -OperationMasterRole (0 à 4). */
const ROLE_NUMBERS: FsmoRole[] = [
  'PDCEmulator',
  'RIDMaster',
  'InfrastructureMaster',
  'SchemaMaster',
  'DomainNamingMaster'
]

/** Rôle désigné par son nom ou son numéro, ou null. */
export function parseFsmoRole(text: string): FsmoRole | null {
  const t = text.trim()
  if (/^\d$/.test(t)) return ROLE_NUMBERS[Number(t)] ?? null
  return FSMO_ROLES.find((r) => r.toLowerCase() === t.toLowerCase()) ?? null
}

/** Détenteur d'un rôle (identifiant d'équipement) : par défaut, le premier contrôleur du domaine. */
export function fsmoHolder(domain: Domain, role: FsmoRole): string | null {
  const holder = domain.fsmo[role]
  return holder && domain.controllers.includes(holder) ? holder : (domain.controllers[0] ?? null)
}

/** Rôles détenus par un contrôleur. */
export function fsmoRolesOf(domain: Domain, dcId: string): FsmoRole[] {
  return FSMO_ROLES.filter((r) => fsmoHolder(domain, r) === dcId)
}

/** Le contrôleur `toId` joint-il `fromId` (RPC) ? */
function dcReachable(state: LabState, toId: string, fromId: string): boolean {
  const ip = addressOf(state, fromId)
  if (!ip || !state.devices[fromId]?.powered || !state.devices[toId]?.powered) return false
  return serverExchange(state, toId, ip, {
    protocol: 'LDAP',
    port: 389,
    request: 'LDAP : transfert de rôle FSMO',
    reply: 'LDAP : rôle transféré',
    fields: []
  }).ok
}

/**
 * Transfère des rôles vers le contrôleur `targetId`. Sans `force`, chaque détenteur actuel doit
 * répondre ; avec `force`, les rôles d'un détenteur injoignable sont pris de force.
 */
export function moveFsmoRoles(
  state: LabState,
  domainName: string,
  targetId: string,
  roles: FsmoRole[],
  options: { force?: boolean } = {}
): EngineResult<{ seized: FsmoRole[] }> {
  return transact(state, (draft) => {
    const domain = requireDomain(draft, domainName)
    const target = draft.devices[targetId]
    if (!target || !domain.controllers.includes(targetId))
      raise('NotDomainController', 'Le serveur cible n’est pas contrôleur du domaine.')
    if (!target.powered) raise('ServerDown', `Le contrôleur ${target.name} est éteint.`)
    if (roles.length === 0) raise('NoRole', 'Indiquez au moins un rôle de maître d’opérations.')
    const seized: FsmoRole[] = []
    for (const role of roles) {
      const holder = fsmoHolder(domain as Domain, role)
      if (holder === targetId) continue
      if (holder && !dcReachable(state, targetId, holder)) {
        if (!options.force)
          raise(
            'HolderUnavailable',
            `Le détenteur actuel du rôle ${role} (${draft.devices[holder]?.name ?? holder}) ne répond pas : le transfert est impossible. Utilisez -Force pour prendre le rôle de force.`
          )
        seized.push(role)
      }
      domain.fsmo[role] = targetId
    }
    return { seized }
  })
}
