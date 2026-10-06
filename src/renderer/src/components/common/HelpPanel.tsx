/**
 * Aide intégrée : guide de démarrage et raccourcis clavier.
 */
import { X } from 'lucide-react'
import { useUiStore } from '../../store/ui'

const SHORTCUTS: [string, string][] = [
  ['Ctrl+N / Ctrl+O / Ctrl+S', 'Nouveau / Ouvrir / Enregistrer'],
  ['Ctrl+Maj+S', 'Enregistrer sous'],
  ['Ctrl+Z / Ctrl+Y (ou Ctrl+Maj+Z)', 'Annuler / Rétablir (aussi dans une console, ligne vide)'],
  ['Ctrl+C / Ctrl+V', 'Copier / Coller des équipements'],
  ['V / C / P', 'Outils Sélection / Câble / PDU simple'],
  ['Suppr', 'Supprimer la sélection (sans sélection : outil Supprimer)'],
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
    <div className="fixed inset-0 z-[350] flex items-center justify-center bg-scrim" onClick={close}>
      <div
        className="max-h-[80vh] w-[560px] overflow-y-auto rounded-md border border-line bg-overlay p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-fg">
            {panel === 'guide' ? 'Guide de démarrage' : 'Raccourcis clavier'}
          </h2>
          <button
            type="button"
            onClick={close}
            className="rounded p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
            title="Fermer"
          >
            <X size={18} />
          </button>
        </div>
        {panel === 'shortcuts' ? (
          <table className="w-full text-sm">
            <tbody>
              {SHORTCUTS.map(([keys, label]) => (
                <tr key={keys} className="border-b border-line">
                  <td className="py-1.5 pr-4 font-mono text-xs text-fg-muted">{keys}</td>
                  <td className="py-1.5 text-fg">{label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-[13px] text-fg">
            <li>Glissez des équipements depuis la palette (à gauche) vers le canvas.</li>
            <li>
              Choisissez l’outil « Câble », cliquez sur un équipement, choisissez un port, puis faites de même
              sur le second.
            </li>
            <li>
              Les voyants indiquent l’état du lien : <b className="text-ok">vert</b> actif,{' '}
              <b className="text-warn">orange</b> adressage incomplet, <b className="text-danger">rouge</b>{' '}
              inactif.
            </li>
            <li>
              Double-cliquez sur un équipement pour ouvrir sa fenêtre : l’onglet Config permet de régler
              l’adressage IP de chaque carte et, pour un routeur, ses routes statiques.
            </li>
            <li>
              L’outil « PDU simple » envoie un ping d’un équipement à un autre. En mode Simulation (Ctrl+2),
              les trames (ARP, ICMP…) sont rejouées pas à pas : cliquez sur un événement pour voir le détail
              de chaque couche.
            </li>
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
