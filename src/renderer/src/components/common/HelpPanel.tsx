/**
 * Aide intégrée : guide de démarrage et raccourcis clavier (générés depuis le catalogue partagé
 * `shared/shortcuts.ts`, d'où le menu natif tire aussi ses accélérateurs).
 */
import { X } from 'lucide-react'
import { formatShortcut, SHORTCUT_GROUPS, SHORTCUTS, type Shortcut } from '@shared/shortcuts'
import { useUiStore } from '../../store/ui'

/** Raccourcis groupés, dans l'ordre de l'aide (catalogue partagé avec le menu natif). */
const SHORTCUT_ROWS = SHORTCUT_GROUPS.map((group) => ({
  group,
  rows: (Object.values(SHORTCUTS) as Shortcut[]).filter((s) => s.group === group)
}))

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
          <table className="w-full text-sm" data-testid="shortcuts-table">
            {SHORTCUT_ROWS.map(({ group, rows }) => (
              <tbody key={group}>
                <tr>
                  <th
                    colSpan={2}
                    className="pt-3 pb-1 text-left text-xs font-semibold text-fg-subtle uppercase"
                  >
                    {group}
                  </th>
                </tr>
                {rows.map((shortcut) => (
                  <tr key={shortcut.label} className="border-b border-line">
                    <td className="py-1.5 pr-4 font-mono text-xs whitespace-nowrap text-fg-muted">
                      {shortcut.keys.map(formatShortcut).join(' ou ')}
                    </td>
                    <td className="py-1.5 text-fg">{shortcut.label}</td>
                  </tr>
                ))}
              </tbody>
            ))}
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
