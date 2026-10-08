/**
 * Actions du moteur propres aux équipements IOS (fonctions pures, immer).
 */
import type { Draft } from 'immer'
import { raise, transact, type EngineResult } from '../core/result'
import { nextSeq } from '../model/factory'
import type { LabState } from '../model/schema'
import { createSubinterfaceDraft, insertSubinterface } from './config'
import { isIos, type IosDevice } from './device'

/**
 * Crée la sous-interface `name` (Gi0/0.10) d'un routeur IOS, sans encapsulation : comme sur IOS,
 * elle n'achemine rien tant que `encapsulation dot1Q` n'est pas configuré. Renvoie son identifiant.
 */
export function createSubinterface(
  state: LabState,
  deviceId: string,
  parentId: string,
  name: string
): EngineResult<string> {
  return transact(state, (draft) => {
    const router = draft.devices[deviceId]
    if (!router || router.kind !== 'router' || !isIos(router)) raise('NotARouter', 'Routeur IOS introuvable.')
    const parent = router.interfaces.find((i) => i.id === parentId && !i.subinterface)
    if (!parent) raise('InterfaceNotFound', 'Interface physique introuvable.')
    if (router.interfaces.some((i) => i.name === name))
      raise('Duplicate', `La sous-interface ${name} existe déjà.`)
    const sub = createSubinterfaceDraft(parent, name, nextSeq(draft))
    insertSubinterface(router.interfaces, sub)
    return sub.id
  })
}

/** Supprime une sous-interface par son nom (no interface Gi0/0.10) et ses câbles logiques. */
export function removeSubinterfaceByName(state: LabState, deviceId: string, name: string): EngineResult {
  return transact(state, (draft) => {
    const device = draft.devices[deviceId]
    const index = device?.interfaces.findIndex((i) => i.name === name && i.subinterface) ?? -1
    if (!device || index < 0) raise('InterfaceNotFound', 'Sous-interface introuvable.')
    device.interfaces.splice(index, 1)
    return undefined
  })
}

/**
 * Modifie un équipement IOS dans une transaction (configuration IOS, interfaces) : utilisé par les
 * commandes de la CLI. La recette peut lever une erreur métier (raise).
 */
export function updateIos(
  state: LabState,
  deviceId: string,
  recipe: (device: Draft<IosDevice>, draft: Draft<LabState>) => void
): EngineResult {
  return transact(state, (draft) => {
    const device = draft.devices[deviceId]
    if (!isIos(device as IosDevice | undefined)) raise('NotIos', 'Équipement IOS introuvable.')
    recipe(device as Draft<IosDevice>, draft)
    return undefined
  })
}
