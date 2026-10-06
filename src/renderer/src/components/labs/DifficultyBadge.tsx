/**
 * Badge de difficulté d'un lab (sélecteur de labs, écran d'accueil).
 */
import type { LabDefinition } from '@engine/index'

const DIFFICULTY_CLASS: Record<LabDefinition['difficulty'], string> = {
  Débutant: 'bg-ok-soft text-ok',
  Intermédiaire: 'bg-warn-soft text-warn',
  Avancé: 'bg-danger-soft text-danger'
}

export function DifficultyBadge({ difficulty }: { difficulty: LabDefinition['difficulty'] }) {
  return (
    <span className={`rounded-sm px-1.5 py-0.5 text-[11px] font-semibold ${DIFFICULTY_CLASS[difficulty]}`}>
      {difficulty}
    </span>
  )
}
