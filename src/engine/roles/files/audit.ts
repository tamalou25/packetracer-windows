/**
 * Règles d'audit du rôle Fichiers : protocole SMB 1.0, partages ouverts à tous.
 */
import type { HostDevice, LabState } from '../../model/schema'
import { WELL_KNOWN_SIDS } from '../../model/schema'
import type { AuditRule } from '../../audit/types'

const hosts = (state: LabState): HostDevice[] =>
  Object.values(state.devices).filter((d): d is HostDevice => d.kind === 'server' || d.kind === 'client')

export const filesAuditRules: AuditRule[] = [
  {
    id: 'smb1',
    title: 'Protocole SMB 1.0 activé',
    severity: 'critique',
    fix: 'Désactivez SMB 1.0 : Set-SmbServerConfiguration -EnableSMB1Protocol $false -Force.',
    refs: ['anssi-21', 'cis-4.8'],
    check: (state) =>
      hosts(state)
        .filter((h) => h.host.smb1)
        .map((h) => ({
          object: h.name,
          detail: 'Le serveur SMB accepte le protocole SMB 1.0, obsolète et vulnérable.'
        }))
  },
  {
    id: 'everyoneFullControl',
    title: 'Partage « Tout le monde : Contrôle total »',
    severity: 'élevée',
    fix: 'Retirez Tout le monde des autorisations du partage et accordez Modifier ou Lecture à un groupe précis (Revoke-SmbShareAccess, Grant-SmbShareAccess).',
    refs: ['anssi-9', 'cis-3.3'],
    check: (state) =>
      hosts(state).flatMap((h) =>
        (h.kind === 'server' ? h.storage.shares : [])
          .filter((s) =>
            s.acl.some(
              (a) => a.principal === WELL_KNOWN_SIDS.everyone && a.type === 'Allow' && a.rights === 'Full'
            )
          )
          .map((s) => ({
            object: `${h.name} › partage ${s.name}`,
            detail: 'Tout le monde dispose du contrôle total sur le partage.'
          }))
      )
  }
]
