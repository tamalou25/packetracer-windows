/**
 * Écran de connexion : compte local ou compte du domaine (authentification Kerberos tracée).
 */
import { useState } from 'react'
import { LogIn, UserCircle2 } from 'lucide-react'
import { changePasswordAndLogon, logon, type HostDevice } from '@engine/index'
import { runDirectoryOperation } from '../../lib/directory'
import { useLabStore } from '../../store/lab'
import { Button, inputClass } from '../common/ui'

export function LogonScreen({ device }: { device: HostDevice }) {
  const domain = device.host.domain ? useLabStore.getState().lab.domains[device.host.domain] : undefined
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [target, setTarget] = useState<string>(domain?.netbios ?? device.name)
  const [error, setError] = useState('')
  const [mustChange, setMustChange] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = () => {
    const lab = useLabStore.getState().lab
    const input = { user, password, domain: target === device.name ? null : target }
    if (mustChange && newPassword !== confirm) {
      setError('Les mots de passe ne correspondent pas.')
      return
    }
    const op = mustChange
      ? changePasswordAndLogon(lab, device.id, { ...input, newPassword })
      : logon(lab, device.id, input)
    setBusy(true)
    runDirectoryOperation(op, () => {
      setBusy(false)
      if (op.ok) return
      if (op.mustChangePassword) {
        setMustChange(true)
        setError(op.message)
      } else setError(op.message)
    })
  }

  return (
    <div
      className="flex h-full items-center justify-center bg-gradient-to-br from-sky-900 via-indigo-900 to-slate-900"
      data-testid="logon-screen"
    >
      <form
        className="flex w-80 flex-col items-center gap-3 rounded-xl bg-white/10 p-6 text-white backdrop-blur"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <UserCircle2 size={56} strokeWidth={1.2} />
        <div className="text-sm text-slate-200">
          {mustChange ? 'Changement du mot de passe' : `Ouvrir une session sur ${device.name}`}
        </div>
        <input
          className={`${inputClass} text-slate-900`}
          placeholder="Nom d’utilisateur"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          data-testid="logon-user"
          autoFocus
        />
        <input
          className={`${inputClass} text-slate-900`}
          type="password"
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="logon-password"
        />
        {mustChange && (
          <>
            <input
              className={`${inputClass} text-slate-900`}
              type="password"
              placeholder="Nouveau mot de passe"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              data-testid="logon-new-password"
            />
            <input
              className={`${inputClass} text-slate-900`}
              type="password"
              placeholder="Confirmer le mot de passe"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              data-testid="logon-confirm"
            />
          </>
        )}
        <label className="flex w-full items-center gap-2 text-xs text-slate-200">
          Se connecter à :
          <select
            className={`${inputClass} text-slate-900`}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            data-testid="logon-domain"
          >
            {domain && <option value={domain.netbios}>{domain.netbios}</option>}
            <option value={device.name}>{device.name} (cet ordinateur)</option>
          </select>
        </label>
        {error && (
          <p className="w-full rounded bg-red-500/20 p-2 text-xs text-red-100" data-testid="logon-error">
            {error}
          </p>
        )}
        <Button
          variant="primary"
          className="w-full"
          disabled={busy}
          data-testid="logon-submit"
          onClick={submit}
        >
          <LogIn size={14} /> {busy ? 'Authentification…' : 'Se connecter'}
        </Button>
        <p className="text-center text-[10px] text-slate-300">
          Compte local : Administrateur / P@ssw0rd
          {device.kind === 'client' ? ' — ou Utilisateur sans mot de passe' : ''}
        </p>
      </form>
    </div>
  )
}
