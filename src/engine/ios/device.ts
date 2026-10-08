/**
 * Équipements Cisco IOS : routeurs et switchs du moteur dotés d'un modèle IOS.
 */
import type { Device, LabState, RouterDevice, SwitchDevice } from '../model/schema'

export type IosDevice = (RouterDevice | SwitchDevice) & {
  model: NonNullable<RouterDevice['model'] | SwitchDevice['model']>
}

/** Vrai si l'équipement est un routeur ou un switch Cisco IOS. */
export function isIos(device: Device | undefined): device is IosDevice {
  return (device?.kind === 'router' || device?.kind === 'switch') && device.model !== undefined
}

/** Vrai si l'équipement d'identifiant `deviceId` est un équipement Cisco IOS. */
export function isIosDevice(state: LabState, deviceId: string): boolean {
  return isIos(state.devices[deviceId])
}
