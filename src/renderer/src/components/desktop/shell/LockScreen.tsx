/**
 * Écran de verrouillage et d'ouverture de session : horloge, « Ctrl+Alt+Suppr », choix du compte
 * (compte local ou « Autre utilisateur » du domaine), changement de mot de passe imposé.
 * Ouverture de session : action du moteur (Kerberos tracé). Déverrouillage : identifiants vérifiés
 * localement, la session reste ouverte.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowRight, Keyboard, Power, RotateCcw, UserRound, UsersRound } from 'lucide-react'
import {
  changePasswordAndLogon,
  formatClockParts,
  logon,
  restartComputer,
  setPower,
  verifyCredentials,
  type HostDevice
} from '@engine/index'
import { runDirectoryOperation } from '../../../lib/directory'
import { runAction } from '../../../lib/run'
import { useDesktopStore } from '../../../store/desktop'
import { useLabStore } from '../../../store/lab'

type Stage = 'lock' | 'notice' | 'form' | 'busy' | 'error' | 'change'

/** Compte saisi : « LAB\\jdupont », « jdupont@lab.local », « .\\Administrateur » ou « jdupont ». */
export function parseAccount(
  input: string,
  device: HostDevice,
  defaultDomain: string | null
): { user: string; domain: string | null } {
  const text = input.trim()
  const slash = text.indexOf('\\')
  if (slash >= 0) {
    const prefix = text.slice(0, slash)
    const user = text.slice(slash + 1)
    const local = prefix === '.' || prefix.toUpperCase() === device.name.toUpperCase()
    return { user, domain: local ? null : prefix }
  }
  const at = text.indexOf('@')
  if (at >= 0) return { user: text.slice(0, at), domain: text.slice(at + 1) }
  return { user: text, domain: defaultDomain }
}

const LOCAL_USER = { server: 'Administrateur', client: 'Utilisateur' } as const

export function LockScreen({ device, mode }: { device: HostDevice; mode: 'logon' | 'unlock' }) {
  const clock = useLabStore((s) => s.lab.clock)
  const domain = useLabStore((s) => (device.host.domain ? s.lab.domains[device.host.domain] : undefined))
  const session = device.host.session
  const [stage, setStage] = useState<Stage>('lock')
  // Compte choisi : utilisateur local par défaut, ou « Autre utilisateur » sur un membre du domaine
  const [other, setOther] = useState(!!domain)
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  /** Étape à laquelle revenir après le message d'erreur. */
  const [errorReturn, setErrorReturn] = useState<Stage>('form')
  const firstField = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const parts = formatClockParts(clock)

  useEffect(() => {
    if (stage === 'lock') rootRef.current?.focus()
    if (stage === 'form' || stage === 'change') requestAnimationFrame(() => firstField.current?.focus())
  }, [stage, other])

  const defaultDomain = domain?.netbios ?? null
  const account =
    mode === 'unlock' && session
      ? { user: session.user, domain: session.domain }
      : other
        ? parseAccount(user, device, defaultDomain)
        : { user: LOCAL_USER[device.kind], domain: null }
  const signInTo = account.domain ?? device.name
  // Message légal imposé par la stratégie d'ordinateur, affiché avant l'ouverture de session
  const computerPolicy = device.host.policy.computer?.settings
  const legal =
    mode === 'logon' && (computerPolicy?.logonMessageTitle || computerPolicy?.logonMessageText)
      ? { title: computerPolicy.logonMessageTitle ?? '', text: computerPolicy.logonMessageText ?? '' }
      : null
  const afterCad = () => setStage(legal ? 'notice' : 'form')

  const fail = (message: string, back: Stage = 'form') => {
    setError(message)
    setErrorReturn(back)
    if (back === 'form') setPassword('')
    setStage('error')
  }

  const submit = () => {
    const lab = useLabStore.getState().lab
    if (mode === 'unlock') {
      if (verifyCredentials(lab, device.id, { ...account, password })) {
        useDesktopStore.getState().setLocked(device.id, false)
        return
      }
      fail('Le mot de passe est incorrect. Réessayez.')
      return
    }
    if (!account.user) return
    if (stage === 'change') {
      if (newPassword !== confirm) {
        fail('Les mots de passe ne correspondent pas.', 'change')
        return
      }
      const op = changePasswordAndLogon(lab, device.id, { ...account, password, newPassword })
      setStage('busy')
      runDirectoryOperation(op, () => {
        if (!op.ok) fail(op.message, 'change')
        else useDesktopStore.getState().setLocked(device.id, false)
      })
      return
    }
    const op = logon(lab, device.id, { ...account, password })
    setStage('busy')
    runDirectoryOperation(op, () => {
      if (op.ok) {
        useDesktopStore.getState().setLocked(device.id, false)
        return
      }
      if (op.mustChangePassword) {
        setError(op.message)
        setStage('change')
        return
      }
      fail(op.message)
    })
  }

  const onLockKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // Ctrl+Alt+Fin / Ctrl+Alt+Inser (comme dans une machine virtuelle), Entrée ou Espace
    if (
      (e.ctrlKey && e.altKey && (e.key === 'End' || e.key === 'Insert' || e.key === 'Delete')) ||
      e.key === 'Enter' ||
      e.key === ' '
    ) {
      e.preventDefault()
      afterCad()
    }
  }

  const powerMenu = (
    <div className="absolute right-4 bottom-4 flex gap-1 text-white/90">
      <button
        type="button"
        title="Redémarrer"
        className="rounded p-2 hover:bg-white/15"
        onClick={() => runAction((l) => restartComputer(l, device.id, 'Autre (non planifié)'))}
      >
        <RotateCcw size={16} />
      </button>
      <button
        type="button"
        title="Arrêter"
        className="rounded p-2 hover:bg-white/15"
        onClick={() => runAction((l) => setPower(l, device.id, false))}
      >
        <Power size={16} />
      </button>
    </div>
  )

  const field =
    'h-8 w-64 border-2 border-white/0 bg-white/90 px-2 text-sm text-black outline-none placeholder:text-neutral-500 focus:border-[#0078d7]'

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={stage === 'lock' ? onLockKey : undefined}
      onClick={stage === 'lock' ? afterCad : undefined}
      className="relative h-full overflow-hidden bg-[radial-gradient(ellipse_at_30%_20%,#1d5f9e_0%,#123d6b_45%,#0a1f3a_100%)] text-white outline-none select-none"
      data-testid="logon-screen"
    >
      {stage === 'lock' ? (
        <>
          <div className="absolute bottom-16 left-10">
            <div className="text-7xl font-light tracking-tight">{parts.time}</div>
            <div className="text-2xl font-light first-letter:uppercase">{parts.longDate}</div>
          </div>
          <div className="absolute inset-x-0 bottom-6 flex flex-col items-center gap-2 text-sm text-white/90">
            <span className="flex items-center gap-2">
              <Keyboard size={16} /> Appuyez sur Ctrl+Alt+Suppr pour déverrouiller.
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                afterCad()
              }}
              className="rounded border border-white/40 px-3 py-1 text-xs hover:bg-white/15"
              title="Envoie la combinaison Ctrl+Alt+Suppr à l’ordinateur"
              data-testid="send-cad"
            >
              Envoyer Ctrl+Alt+Suppr
            </button>
          </div>
        </>
      ) : stage === 'notice' && legal ? (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/35 px-10 backdrop-blur-sm"
          data-testid="logon-notice"
        >
          <div className="text-2xl font-light">{legal.title}</div>
          <p className="max-w-xl text-center text-sm leading-relaxed whitespace-pre-line text-white/90">
            {legal.text}
          </p>
          <button
            type="button"
            className="min-w-24 border-2 border-white/40 bg-white/15 px-4 py-1 text-sm hover:bg-white/25"
            onClick={() => setStage('form')}
            data-testid="logon-notice-ok"
          >
            OK
          </button>
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/25 backdrop-blur-sm">
          <div className="mb-4 flex h-28 w-28 items-center justify-center rounded-full bg-white/20">
            <UserRound size={64} strokeWidth={1} />
          </div>
          <div className="mb-1 text-2xl font-light">
            {mode === 'unlock' && session
              ? session.user
              : other
                ? 'Autre utilisateur'
                : LOCAL_USER[device.kind]}
          </div>
          {mode === 'unlock' && <div className="mb-3 text-sm text-white/80">Verrouillé</div>}

          {stage === 'busy' && <div className="mt-4 text-sm text-white/90">Bienvenue…</div>}

          {stage === 'error' && (
            <div className="mt-3 flex flex-col items-center gap-3">
              <p className="max-w-80 text-center text-sm" data-testid="logon-error">
                {error}
              </p>
              <button
                type="button"
                className="min-w-24 border-2 border-white/40 bg-white/15 px-4 py-1 text-sm hover:bg-white/25"
                onClick={() => setStage(errorReturn)}
                data-testid="logon-error-ok"
              >
                OK
              </button>
            </div>
          )}

          {(stage === 'form' || stage === 'change') && (
            <form
              className="mt-3 flex flex-col items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
            >
              {stage === 'change' && <p className="mb-1 max-w-72 text-center text-sm">{error}</p>}
              {mode === 'logon' && other && stage === 'form' && (
                <input
                  ref={firstField}
                  className={field}
                  placeholder="Nom d’utilisateur"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  data-testid="logon-user"
                />
              )}
              <div className="flex">
                <input
                  ref={mode === 'unlock' || !other || stage === 'change' ? firstField : undefined}
                  className={field}
                  type="password"
                  placeholder={stage === 'change' ? 'Ancien mot de passe' : 'Mot de passe'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  data-testid="logon-password"
                />
                {stage === 'form' && (
                  <button
                    type="submit"
                    className="flex h-8 w-8 items-center justify-center bg-white/25 hover:bg-[#0078d7]"
                    title="Se connecter"
                    data-testid="logon-submit"
                  >
                    <ArrowRight size={16} />
                  </button>
                )}
              </div>
              {stage === 'change' && (
                <>
                  <input
                    className={field}
                    type="password"
                    placeholder="Nouveau mot de passe"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    data-testid="logon-new-password"
                  />
                  <div className="flex">
                    <input
                      className={field}
                      type="password"
                      placeholder="Confirmer le mot de passe"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      data-testid="logon-confirm"
                    />
                    <button
                      type="submit"
                      className="flex h-8 w-8 items-center justify-center bg-white/25 hover:bg-[#0078d7]"
                      title="Changer le mot de passe"
                      data-testid="logon-submit"
                    >
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </>
              )}
              {mode === 'logon' && (
                <p className="mt-1 text-xs text-white/80" data-testid="logon-target">
                  Se connecter à : {signInTo}
                </p>
              )}
            </form>
          )}

          {mode === 'logon' && stage !== 'busy' && (
            <div className="absolute bottom-4 left-4 flex flex-col gap-1">
              <button
                type="button"
                onClick={() => {
                  setOther(false)
                  setStage('form')
                }}
                className={`flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-white/15 ${!other ? 'bg-white/20' : ''}`}
                data-testid="logon-local-user"
              >
                <UserRound size={18} /> {LOCAL_USER[device.kind]}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOther(true)
                  setStage('form')
                }}
                className={`flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-white/15 ${other ? 'bg-white/20' : ''}`}
                data-testid="logon-other-user"
              >
                <UsersRound size={18} /> Autre utilisateur
              </button>
            </div>
          )}
        </div>
      )}
      {powerMenu}
    </div>
  )
}
