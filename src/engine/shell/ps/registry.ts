/**
 * Registre déclaratif des cmdlets : paramètres, types, positions, disponibilité.
 * La liaison des paramètres et la complétion Tab en sont dérivées.
 */
import type { CmdContext } from './interpreter'
import type { PsValue } from './values'

export type ParamType =
  'string' | 'string[]' | 'int' | 'bool' | 'switch' | 'secure' | 'credential' | 'script' | 'any'

export interface ParamDef {
  name: string
  type: ParamType
  mandatory?: boolean
  position?: number
  aliases?: string[]
  validateSet?: string[]
  /** Accepte l'entrée du pipeline. */
  pipeline?: boolean
  /** Saisie sécurisée demandée deux fois (mot de passe de restauration…). */
  confirm?: boolean
  /** Valeurs proposées par la complétion Tab. */
  complete?: (ctx: CmdContext) => string[]
}

export type BoundArgs = Record<string, PsValue>

export interface CmdletDef {
  name: string
  aliases?: string[]
  /** Module (affiché par Get-Command, utilisé dans les identifiants d'erreur). */
  module: string
  synopsis: string
  params: ParamDef[]
  /** La commande existe-t-elle sur cet ordinateur (module installé, système serveur…) ? */
  available?: (ctx: CmdContext) => boolean
  run: (ctx: CmdContext, args: BoundArgs, input: PsValue[]) => PsValue[] | void
}

/** Paramètres communs acceptés par toutes les cmdlets. */
export const COMMON_PARAMS: ParamDef[] = [
  { name: 'Confirm', type: 'switch' },
  { name: 'WhatIf', type: 'switch' },
  { name: 'Verbose', type: 'switch', aliases: ['vb'] },
  { name: 'Debug', type: 'switch', aliases: ['db'] },
  { name: 'ErrorAction', type: 'string', aliases: ['ea'] }
]
