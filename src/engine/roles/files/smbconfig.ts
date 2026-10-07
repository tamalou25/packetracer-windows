/**
 * Configuration du serveur SMB (Set-SmbServerConfiguration) : protocole SMB 1.0, désactivé par
 * défaut depuis Windows Server 2016 (version 1709).
 */
import { raise, transact, type EngineResult } from '../../core/result'
import type { LabState } from '../../model/schema'
import { requireDevice } from '../../topology/actions'

/** Active ou désactive le protocole SMB 1.0 du serveur SMB de l'ordinateur. */
export function setSmb1(state: LabState, deviceId: string, enabled: boolean): EngineResult {
  return transact(state, (draft) => {
    const device = requireDevice(draft, deviceId)
    if (device.kind !== 'server' && device.kind !== 'client')
      raise('NotSupported', 'Le serveur SMB se configure sur un serveur ou un poste.')
    device.host.smb1 = enabled
    return undefined
  })
}
