/**
 * Serveur NPS (RADIUS) : clients RADIUS et stratégies réseau.
 */
import { z } from 'zod'

export const RadiusClientSchema = z.object({
  /** Nom convivial (SRV2-VPN). */
  name: z.string(),
  /** Adresse du client RADIUS (serveur VPN). */
  address: z.string(),
  sharedSecret: z.string()
})

/** Stratégie réseau : condition « Groupes Windows », autorisation d'accès. */
export const NetworkPolicySchema = z.object({
  name: z.string(),
  enabled: z.boolean().default(true),
  /**
   * Condition « Groupes Windows » : identifiants (SID) des groupes du domaine, remplie si
   * l'utilisateur est membre de l'un d'eux. Vide : la stratégie s'applique à toute demande.
   */
  groups: z.array(z.string()).default([]),
  access: z.enum(['Grant', 'Deny'])
})

export const NpsStateSchema = z.object({
  radiusClients: z.array(RadiusClientSchema).default([]),
  /** Stratégies dans l'ordre de traitement. */
  policies: z.array(NetworkPolicySchema).default([])
})

export type RadiusClient = z.infer<typeof RadiusClientSchema>
export type NetworkPolicy = z.infer<typeof NetworkPolicySchema>
export type NpsState = z.infer<typeof NpsStateSchema>
