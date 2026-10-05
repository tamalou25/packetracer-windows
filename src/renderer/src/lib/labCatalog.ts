/**
 * Catalogue des labs fournis avec l'application (dossier labs/, intégré à la compilation).
 */
import { parseLab, type LabDefinition } from '@engine/index'

const modules = import.meta.glob('../../../../labs/*.json', { eager: true, import: 'default' })

/** Labs disponibles, triés par identifiant (lab-01, lab-02…). */
export const LABS: LabDefinition[] = Object.entries(modules)
  .sort(([a], [b]) => a.localeCompare(b))
  .flatMap(([, raw]) => {
    const parsed = parseLab(raw)
    return parsed.ok ? [parsed.lab] : []
  })

export function labById(id: string): LabDefinition | undefined {
  return LABS.find((l) => l.id === id)
}
