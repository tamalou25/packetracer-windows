/**
 * Connexion Bureau à distance (mstsc) : ordinateur, compte, mot de passe et programme RemoteApp
 * facultatif ; la connexion est rejouée en mode Simulation (TCP 3389).
 */
import { useState } from 'react'
import { MonitorSmartphone } from 'lucide-react'
import { command, rdpConnect, type HostDevice } from '@engine/index'
import { runNetworkOperation } from '../../../lib/network'
import { runCommand } from '../../../lib/run'
import { useLabStore } from '../../../store/lab'
import { DialogBody, DialogFooter, GroupBox, WinButton, WinInput } from '../shell/classic'

export function RemoteDesktop({ device }: { device: HostDevice }) {
  const [computer, setComputer] = useState('')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [app, setApp] = useState('')
  const [result, setResult] = useState<{ ok: boolean; message: string; computer: string } | null>(null)

  const connect = () => {
    const input = { computer, user, password, app: app.trim() || null }
    // Aperçu de la trace (sans modifier l'état), puis commande appliquée à la fin de l'animation
    const preview = rdpConnect(useLabStore.getState().lab, device.id, input)
    runNetworkOperation(preview.trace, () => {
      const r = runCommand(command('rds.connect', device.id, input))
      if (r) setResult({ ok: r.ok, message: r.message, computer })
    })
  }

  return (
    <div className="flex h-full flex-col" data-testid="mstsc">
      <DialogBody className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <MonitorSmartphone size={34} className="text-[#1e6fbf]" strokeWidth={1.4} />
          <p className="text-sm">Connexion Bureau à distance</p>
        </div>
        <GroupBox label="Paramètres d’ouverture de session">
          <label className="mb-1 block">Ordinateur :</label>
          <WinInput
            value={computer}
            onChange={(e) => setComputer(e.target.value)}
            placeholder="srv1.lab.local"
            data-testid="mstsc-computer"
          />
          <label className="mt-2 mb-1 block">Nom d’utilisateur :</label>
          <WinInput
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="LAB\jdupont"
            data-testid="mstsc-user"
          />
          <label className="mt-2 mb-1 block">Mot de passe :</label>
          <WinInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="mstsc-password"
          />
          <label className="mt-2 mb-1 block">Programme RemoteApp (alias, facultatif) :</label>
          <WinInput
            value={app}
            onChange={(e) => setApp(e.target.value)}
            placeholder="notepad"
            data-testid="mstsc-app"
          />
        </GroupBox>
        {result && (
          <div
            className={`border p-2 ${result.ok ? 'border-[#107c10] bg-[#dff6dd]' : 'border-[#a4262c] bg-[#fde7e9]'}`}
            data-testid="mstsc-result"
          >
            {result.ok
              ? `Session ouverte sur ${result.computer}${app.trim() ? ` (programme RemoteApp ${app.trim()})` : ''}.`
              : result.message}
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <WinButton primary onClick={connect} data-testid="mstsc-connect">
          Connexion
        </WinButton>
      </DialogFooter>
    </div>
  )
}
