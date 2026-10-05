/**
 * Boîte « Exécuter » : ouvre une console ou un élément du Panneau de configuration par sa commande
 * (ncpa.cpl, sysdm.cpl, dsa.msc, dnsmgmt.msc, dhcpmgmt.msc, eventvwr.msc, servermanager…).
 */
import { useState } from 'react'
import { Play } from 'lucide-react'
import type { HostDevice } from '@engine/index'
import { runCommand } from '../../../lib/desktop'
import { useAppWindow } from '../shell/AppWindow'
import { DialogFooter, WinButton, winInputClass } from '../shell/classic'

/** Historique des commandes (partagé entre les ordinateurs, comme une liste déroulante de session). */
const history: string[] = []

export function RunDialog({ device }: { device: HostDevice }) {
  const win = useAppWindow()
  const [command, setCommand] = useState(history[0] ?? '')
  const submit = () => {
    const text = command.trim()
    if (!text) return
    if (!history.includes(text)) history.unshift(text)
    win?.close()
    runCommand(device.id, text)
  }
  return (
    <div className="flex h-full flex-col bg-[#f0f0f0] text-xs text-black">
      <div className="flex gap-3 p-4">
        <Play size={28} className="shrink-0 fill-[#0078d7] text-[#0078d7]" />
        <p>
          Entrez le nom d’un programme, dossier, document ou ressource Internet, et le système l’ouvrira pour
          vous.
        </p>
      </div>
      <label className="flex items-center gap-3 px-4">
        <span>
          <u>O</u>uvrir :
        </span>
        <input
          autoFocus
          list="run-history"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') win?.close()
          }}
          className={winInputClass}
          data-testid="run-input"
        />
        <datalist id="run-history">
          {history.map((h) => (
            <option key={h} value={h} />
          ))}
        </datalist>
      </label>
      <div className="flex-1" />
      <DialogFooter>
        <WinButton primary onClick={submit} disabled={!command.trim()} data-testid="run-ok">
          OK
        </WinButton>
        <WinButton onClick={() => win?.close()}>Annuler</WinButton>
        <WinButton disabled>Parcourir…</WinButton>
      </DialogFooter>
    </div>
  )
}
