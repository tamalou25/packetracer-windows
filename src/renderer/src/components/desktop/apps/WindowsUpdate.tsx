/**
 * Page « Windows Update » d'un ordinateur : serveur WSUS imposé par stratégie de groupe, groupe
 * d'ordinateurs et mises à jour reçues (seulement celles approuvées pour ce groupe).
 */
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { CLASSIFICATION_LABELS, wsusClientStatus, type HostDevice } from '@engine/index'
import { useLabStore } from '../../../store/lab'
import { runNetworkOperation } from '../../../lib/network'

export function WindowsUpdate({ device }: { device: HostDevice }) {
  const lab = useLabStore((s) => s.lab)
  const [checked, setChecked] = useState(false)
  const status = wsusClientStatus(lab, device.id)
  // Recherche de mises à jour : la requête HTTP vers le serveur est rejouée en mode Simulation
  const check = () => {
    const trace = status.kind === 'none' ? null : status.trace
    if (trace) runNetworkOperation(trace, () => setChecked(true))
    else setChecked(true)
  }
  return (
    <div className="h-full overflow-auto bg-white p-6 text-[13px] text-[#1b1b1b]" data-testid="wu-client">
      <h1 className="mb-1 text-xl font-light">Windows Update</h1>
      {status.kind !== 'none' && (
        <p className="mb-4 text-xs text-[#a4262c]">*Certains paramètres sont gérés par votre organisation.</p>
      )}
      <button
        type="button"
        onClick={check}
        className="mb-4 flex items-center gap-1.5 rounded-sm bg-[#0067c0] px-3 py-1.5 text-white hover:bg-[#1975c5]"
        data-testid="wu-check"
      >
        <RefreshCw size={13} /> Rechercher des mises à jour
      </button>
      {status.kind === 'none' && (
        <p className="text-[#555]">
          Aucun serveur de mises à jour intranet n’est configuré : l’ordinateur utilise le service de mise à
          jour en ligne (non simulé).
        </p>
      )}
      {status.kind === 'error' && checked && (
        <div className="border-l-4 border-[#a4262c] bg-[#fde7e9] p-3" data-testid="wu-error">
          <p className="font-semibold">Un problème est survenu lors de l’installation des mises à jour.</p>
          <p className="mt-1">{status.message}</p>
          <p className="mt-1 text-xs text-[#555]">Serveur configuré : {status.url}</p>
        </div>
      )}
      {status.kind === 'ok' && checked && (
        <div data-testid="wu-result">
          <p className="mb-2 text-xs text-[#555]">
            Serveur : {status.url} — groupe d’ordinateurs : <b>{status.group}</b>
          </p>
          {status.updates.length === 0 ? (
            <p>Vous êtes à jour.</p>
          ) : (
            <>
              <p className="mb-2">Mises à jour disponibles :</p>
              <ul className="flex flex-col gap-1.5">
                {status.updates.map((u) => (
                  <li key={u.id} className="border border-[#e5e5e5] p-2" data-testid={`wu-update-${u.id}`}>
                    <div>{u.title}</div>
                    <div className="text-xs text-[#555]">{CLASSIFICATION_LABELS[u.classification]}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
