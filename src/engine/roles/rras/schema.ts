/**
 * Routage et accès distant (RRAS) : schéma des données du serveur.
 */
import { z } from 'zod'

/** Modes de l'assistant « Configurer et activer le routage et l'accès distant ». */
export const RRAS_MODES = ['nat', 'vpn', 'vpn-nat', 'routing'] as const
export type RrasMode = (typeof RRAS_MODES)[number]

/** Client VPN connecté. */
export const VpnSessionSchema = z.object({
  clientDeviceId: z.string(),
  /** Compte authentifié (LAB\jdupont). */
  user: z.string(),
  /** Adresse attribuée au client (pool). */
  address: z.string(),
  /** Adresse publique du client (extrémité du tunnel). */
  clientAddress: z.string(),
  connectedAt: z.number().default(0)
})

/** Serveur RADIUS d'authentification (fournisseur d'authentification RADIUS). */
export const RadiusServerSchema = z.object({
  /** Nom ou adresse du serveur NPS. */
  server: z.string(),
  sharedSecret: z.string()
})

export const RrasStateSchema = z.object({
  /** Mode configuré (null : non configuré, service arrêté). */
  mode: z.enum(RRAS_MODES).nullable().default(null),
  /** Interface publique du NAT ou du serveur VPN (connectée à Internet). */
  publicIfaceId: z.string().nullable().default(null),
  /** Pool d'adresses statiques des clients VPN. */
  pool: z.object({ start: z.string(), end: z.string() }).nullable().default(null),
  sessions: z.array(VpnSessionSchema).default([]),
  /**
   * Serveurs RADIUS d'authentification, essayés dans l'ordre. Vide : authentification Windows
   * (comptes locaux ou du domaine du serveur).
   */
  radius: z.array(RadiusServerSchema).default([])
})

export type RrasState = z.infer<typeof RrasStateSchema>
export type VpnSession = z.infer<typeof VpnSessionSchema>
export type RadiusServer = z.infer<typeof RadiusServerSchema>
