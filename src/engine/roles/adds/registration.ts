/**
 * Action d'inscription DNS (ipconfig /registerdns, Register-DnsClient).
 */
import { transact, type EngineResult } from '../../core/result'
import type { HostDevice, LabState } from '../../model/schema'
import { registerHostDns } from './join'

export function registerDnsAction(state: LabState, deviceId: string): EngineResult<boolean> {
  return transact(state, (draft) => {
    const device = draft.devices[deviceId]
    if (!device || (device.kind !== 'server' && device.kind !== 'client')) return false
    return registerHostDns(draft, device as HostDevice)
  })
}
