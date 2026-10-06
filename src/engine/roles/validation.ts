/**
 * Validation des données de rôles d'un lab relu (fichier .slab) : chaque entrée de
 * `device.roles` passe par le schéma zod déclaré par son module (valeurs par défaut comprises).
 */
import type { LabState } from '../model/schema'
import { roleModules } from './registry'

/** Valide et complète les données de rôles ; renvoie un message d'erreur, ou null si tout est valide. */
export function validateRoleStates(lab: LabState): string | null {
  const definitions = new Map(
    roleModules().flatMap((m) => (m.state ? [[m.state.key, m.state] as const] : []))
  )
  for (const device of Object.values(lab.devices)) {
    if (device.kind !== 'server') continue
    for (const [key, value] of Object.entries(device.roles)) {
      const where = `lab.devices.${device.id}.roles.${key}`
      const def = definitions.get(key)
      if (!def) return `Fichier .slab invalide (champ ${where}) : rôle inconnu « ${key} ».`
      const parsed = def.schema.safeParse(value)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        const path = issue && issue.path.length > 0 ? `.${issue.path.join('.')}` : ''
        return `Fichier .slab invalide (champ ${where}${path}) : ${issue?.message ?? 'structure inattendue'}.`
      }
      device.roles[key] = parsed.data
    }
  }
  return null
}
