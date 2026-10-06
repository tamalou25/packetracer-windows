/**
 * Données du rôle Hyper-V sur l'hôte (`device.roles.hyperv`). Les machines et commutateurs
 * virtuels sont de vrais équipements du lab (`hostedBy` = l'hôte) ; ces données les décrivent.
 */
import { z } from 'zod'

export const VSWITCH_TYPES = ['External', 'Internal', 'Private'] as const

export const VirtualSwitchSchema = z.object({
  /** Équipement « switch » qui représente le commutateur. */
  deviceId: z.string(),
  name: z.string(),
  type: z.enum(VSWITCH_TYPES),
  /** Commutateur externe : carte physique de l'hôte liée. */
  netAdapter: z.string().nullable().default(null),
  /** Carte virtuelle de l'hôte (vEthernet) reliée au commutateur (interne, externe partagé). */
  hostAdapter: z.string().nullable().default(null)
})

export const VirtualMachineSchema = z.object({
  /** Équipement (serveur ou poste) qui représente la machine virtuelle. */
  deviceId: z.string(),
  generation: z.union([z.literal(1), z.literal(2)]).default(1),
  memoryMB: z.number().int().positive().default(1024)
})

export const HyperVServerSchema = z.object({
  switches: z.array(VirtualSwitchSchema).default([]),
  vms: z.array(VirtualMachineSchema).default([])
})

export type VSwitchType = (typeof VSWITCH_TYPES)[number]
export type VirtualSwitch = z.infer<typeof VirtualSwitchSchema>
export type VirtualMachine = z.infer<typeof VirtualMachineSchema>
export type HyperVServer = z.infer<typeof HyperVServerSchema>
