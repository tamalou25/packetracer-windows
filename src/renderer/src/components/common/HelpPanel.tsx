/**
 * Aide intégrée : guide de démarrage et raccourcis clavier.
 */
import { X } from 'lucide-react'
import { useUiStore } from '../../store/ui'

const SHORTCUTS: [string, string][] = [
  ['Ctrl+N / Ctrl+O / Ctrl+S', 'Nouveau / Ouvrir / Enregistrer'],
  ['Ctrl+Maj+S', 'Enregistrer sous'],
  ['Ctrl+Z / Ctrl+Y', 'Annuler / Rétablir'],
  ['Ctrl+C / Ctrl+V', 'Copier / Coller des équipements'],
  ['Suppr', 'Supprimer la sélection'],
  ['Ctrl+A', 'Tout sélectionner'],
  ['Échap', 'Annuler le câblage, revenir à l’outil Sélection'],
  ['Ctrl+1 / Ctrl+2', 'Mode Temps réel / Mode Simulation'],
  ['F6 / F7 / F8', 'Simulation : avancer / lecture / réinitialiser'],
  ['Ctrl+= / Ctrl+- / Ctrl+0', 'Zoom avant / arrière / ajuster']
]

export function HelpPanel() {
  const panel = useUiStore((s) => s.helpPanel)
  const close = () => useUiStore.getState().setHelpPanel(null)
  if (!panel) return null
  return (
    <div className="fixed inset-0 z-[350] flex items-center justify-center bg-slate-900/40" onClick={close}>
      <div
        className="max-h-[80vh] w-[560px] overflow-y-auto rounded-xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">
            {panel === 'guide' ? 'Guide de démarrage' : 'Raccourcis clavier'}
          </h2>
          <button
            type="button"
            onClick={close}
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
            title="Fermer"
          >
            <X size={18} />
          </button>
        </div>
        {panel === 'shortcuts' ? (
          <table className="w-full text-sm">
            <tbody>
              {SHORTCUTS.map(([keys, label]) => (
                <tr key={keys} className="border-b border-slate-100">
                  <td className="py-1.5 pr-4 font-mono text-xs text-slate-600">{keys}</td>
                  <td className="py-1.5 text-slate-700">{label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-slate-700">
            <li>Glissez des équipements depuis la palette (en bas) vers le canvas.</li>
            <li>
              Choisissez l’outil « Câble », cliquez sur un équipement, choisissez un port, puis faites de même
              sur le second.
            </li>
            <li>
              Les voyants indiquent l’état du lien : <b className="text-green-600">vert</b> actif,{' '}
              <b className="text-amber-600">orange</b> adressage incomplet,{' '}
              <b className="text-red-600">rouge</b> inactif.
            </li>
            <li>Double-cliquez sur un équipement pour ouvrir sa fenêtre (Config, Bureau, Console).</li>
            <li>
              Enregistrez votre lab au format .slab (Fichier &gt; Enregistrer). Une copie de récupération est
              faite toutes les 60 s.
            </li>
          </ol>
        )}
      </div>
    </div>
  )
}
