/**
 * Nouveau partage (Gestionnaire de serveur > Services de fichiers et de stockage > Partages) :
 * dossier (créé s'il n'existe pas), nom du partage, description et autorisations de partage.
 */
import { useState } from 'react'
import { type ServerDevice, command } from '@engine/index'
import { explorerToken } from '../../../lib/explorer'
import { runCommandOk } from '../../../lib/run'
import { useLabStore } from '../../../store/lab'
import { useAppWindow } from '../shell/AppWindow'
import { DialogBody, DialogFooter, GroupBox, WinButton, WinInput } from '../shell/classic'

const PRESETS = {
  read: { label: 'Tout le monde : Lecture (par défaut)', full: [] as string[] },
  full: {
    label: 'Tout le monde : Contrôle total (les droits sont gérés par NTFS)',
    full: ['Tout le monde']
  }
}

export function NewShareDialog({ device }: { device: ServerDevice }) {
  const win = useAppWindow()
  const [path, setPath] = useState('C:\\Partages\\')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [preset, setPreset] = useState<keyof typeof PRESETS>('full')
  const submit = () => {
    const lab = useLabStore.getState().lab
    const token = explorerToken(lab, device)
    const shareName = name.trim() || path.replace(/\\$/, '').split('\\').pop() || ''
    // Le dossier est créé s'il n'existe pas encore, comme dans l'assistant
    const ok = runCommandOk(
      command(
        'files.shareFolder',
        device.id,
        { name: shareName, path, description, full: PRESETS[preset].full },
        token
      )
    )
    if (ok) win?.close()
  }
  return (
    <form
      className="flex h-full flex-col bg-[#f0f0f0]"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      data-testid="newshare"
    >
      <DialogBody className="flex flex-col gap-3">
        <p className="text-sm text-[#1e3287]">Spécifier le dossier et le nom du partage</p>
        <label className="flex flex-col gap-1">
          Chemin local du partage :
          <WinInput value={path} onChange={(e) => setPath(e.target.value)} data-testid="newshare-path" />
        </label>
        <label className="flex flex-col gap-1">
          Nom du partage :
          <WinInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={path.replace(/\\$/, '').split('\\').pop() ?? ''}
            data-testid="newshare-name"
          />
        </label>
        <label className="flex flex-col gap-1">
          Description :
          <WinInput value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <GroupBox label="Autorisations de partage">
          {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((key) => (
            <label key={key} className="flex items-center gap-1.5 py-0.5">
              <input
                type="radio"
                checked={preset === key}
                onChange={() => setPreset(key)}
                data-testid={`newshare-${key}`}
              />
              {PRESETS[key].label}
            </label>
          ))}
        </GroupBox>
        <p className="text-[11px] text-[#555]">
          Chemin distant : \\{device.name}\{name.trim() || path.replace(/\\$/, '').split('\\').pop()}
        </p>
      </DialogBody>
      <DialogFooter>
        <WinButton primary type="submit" data-testid="newshare-create">
          Créer
        </WinButton>
        <WinButton onClick={() => win?.close()}>Annuler</WinButton>
      </DialogFooter>
    </form>
  )
}
