/**
 * Cadre commun des assistants du Gestionnaire de serveur : titre de l'étape, serveur de destination,
 * liste des étapes à gauche, contenu, boutons Précédent / Suivant / Installer / Annuler.
 */
import type { ReactNode } from 'react'

export interface WizardStep {
  id: string
  label: string
}

interface WizardFrameProps {
  /** Titre de l'étape courante (grand titre en haut à gauche). */
  heading: string
  /** Nom du serveur de destination (en haut à droite). */
  destination: string
  steps: WizardStep[]
  current: string
  /** Étapes atteignables par clic (déjà visitées). */
  reachable?: (id: string) => boolean
  onStep?: (id: string) => void
  children: ReactNode
  footer: ReactNode
  testId?: string
}

export function WizardFrame({
  heading,
  destination,
  steps,
  current,
  reachable,
  onStep,
  children,
  footer,
  testId
}: WizardFrameProps) {
  return (
    <div className="flex h-full flex-col bg-white text-xs text-black" data-testid={testId}>
      <div className="flex shrink-0 items-start justify-between px-6 pt-4 pb-3">
        <h2 className="text-xl font-light text-[#1e3287]" data-testid="wiz-heading">
          {heading}
        </h2>
        <div className="text-right text-[11px] leading-tight text-[#555]">
          SERVEUR DE DESTINATION
          <div className="text-xs text-black">{destination}</div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav className="w-48 shrink-0 overflow-y-auto pt-1 pr-2 pl-6">
          {steps.map((s) => {
            const active = s.id === current
            const canGo = !active && !!reachable?.(s.id)
            return (
              <button
                key={s.id}
                type="button"
                disabled={!canGo}
                onClick={() => canGo && onStep?.(s.id)}
                className={`block w-full border-l-2 py-1 pl-2 text-left ${
                  active
                    ? 'border-[#0078d7] font-semibold text-black'
                    : canGo
                      ? 'border-transparent text-[#0066cc] hover:underline'
                      : 'border-transparent text-[#777]'
                }`}
                data-testid={`wiz-step-${s.id}`}
              >
                {s.label}
              </button>
            )
          })}
        </nav>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-6 pb-3 pl-2">{children}</div>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-[#dfdfdf] bg-[#f0f0f0] px-4 py-2.5">
        {footer}
      </div>
    </div>
  )
}

/** Note « À noter » des pages d'information des rôles. */
export function NoteList({ items }: { items: string[] }) {
  return (
    <ul className="ml-4 list-disc space-y-1.5">
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  )
}
