/**
 * Sélecteur de labs (Fichier > Ouvrir un lab…) : labs fournis (titre, difficulté, durée, résumé)
 * et bibliothèque communautaire.
 */
import { useEffect, useState } from 'react'
import { FlaskConical, GraduationCap, Upload, X } from 'lucide-react'
import { LABS } from '../../lib/labCatalog'
import { importAndOpenLab, openLabEditor } from '../../lib/labEditor'
import { openLab } from '../../lib/labs'
import { useLabsStore } from '../../store/labs'
import { Button } from '../common/ui'
import { DifficultyBadge } from './DifficultyBadge'
import { LibraryList } from './LibraryList'

export function LabPicker() {
  const open = useLabsStore((s) => s.pickerOpen)
  const [tab, setTab] = useState<'builtin' | 'library'>('builtin')
  const close = () => useLabsStore.getState().setPickerOpen(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-scrim"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex max-h-[85vh] w-[640px] flex-col rounded-md border border-line bg-overlay shadow-lg"
        data-testid="lab-picker"
      >
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <GraduationCap size={18} className="text-accent" />
          <h2 className="text-base font-semibold text-fg">Ouvrir un lab</h2>
          <button
            type="button"
            onClick={close}
            className="ml-auto rounded p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"
            aria-label="Fermer"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex border-b border-line px-5" role="tablist">
          {(
            [
              ['builtin', 'Labs fournis'],
              ['library', 'Bibliothèque']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              data-testid={`picker-tab-${id}`}
              className={`border-b-2 px-3 py-2 text-[12px] font-semibold ${
                tab === id ? 'border-accent text-fg' : 'border-transparent text-fg-subtle hover:text-fg-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'library' ? (
          <LibraryList />
        ) : (
          <>
            <p className="px-5 pt-3 text-[13px] text-fg-muted">
              Chaque lab part d’une topologie prête à l’emploi. Réalisez les tâches de l’énoncé, puis cliquez
              sur
              <strong className="text-fg"> Vérifier</strong> dans l’onglet Lab : chaque objectif est validé,
              avec un indice en cas d’échec.
            </p>
            <ul className="min-h-0 flex-1 overflow-y-auto p-5">
              {LABS.map((lab, i) => (
                <li
                  key={lab.id}
                  className="mb-3 flex items-start gap-3 rounded-md border border-line bg-surface p-3"
                >
                  <span className="mt-0.5 font-mono text-[12px] text-fg-subtle">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold text-fg">{lab.title}</span>
                      <DifficultyBadge difficulty={lab.difficulty} />
                      <span className="text-[11px] text-fg-subtle">{lab.duration}</span>
                    </div>
                    <p className="mt-1 text-[12px] text-fg-muted">{lab.summary}</p>
                  </div>
                  <Button
                    variant="primary"
                    onClick={() => void openLab(lab)}
                    data-testid={`lab-open-${lab.id}`}
                  >
                    Ouvrir
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          <Button onClick={() => void importAndOpenLab()} data-testid="lab-import">
            <Upload size={14} /> Importer un lab…
          </Button>
          <Button onClick={openLabEditor} data-testid="lab-create">
            <FlaskConical size={14} /> Créer un lab…
          </Button>
        </div>
      </div>
    </div>
  )
}
