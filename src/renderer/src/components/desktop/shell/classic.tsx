/**
 * Éléments d'interface « classiques » du système simulé (boîtes de dialogue, assistants) :
 * boutons, cadres, onglets, champ d'adresse IP en quatre octets, boîtes de message.
 * Le Bureau simulé a sa propre palette claire, indépendante du thème de l'application.
 */
import { useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { CircleHelp, CircleX, Info, TriangleAlert } from 'lucide-react'

export function WinButton({
  primary = false,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={`h-[24px] min-w-[76px] rounded-[2px] border px-3 text-xs text-black transition-colors disabled:cursor-default disabled:border-[#bfbfbf] disabled:bg-[#cccccc] disabled:text-[#838383] ${
        primary
          ? 'border-[#0078d7] bg-[#e1e1e1] shadow-[inset_0_0_0_1px_#0078d7] hover:bg-[#e5f1fb] active:bg-[#cce4f7]'
          : 'border-[#adadad] bg-[#e1e1e1] hover:border-[#0078d7] hover:bg-[#e5f1fb] active:bg-[#cce4f7]'
      } ${className}`}
    />
  )
}

export const winInputClass =
  'h-[23px] w-full rounded-none border border-[#7a7a7a] bg-white px-1.5 text-xs text-black outline-none focus:border-[#0078d7] disabled:border-[#cccccc] disabled:bg-[#f0f0f0] disabled:text-[#6d6d6d]'

export function WinInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${winInputClass} ${props.className ?? ''}`} />
}

export function GroupBox({
  label,
  children,
  className = ''
}: {
  label: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <fieldset className={`rounded-[2px] border border-[#dcdcdc] px-3 pt-1 pb-2.5 ${className}`}>
      <legend className="px-1 text-xs text-black">{label}</legend>
      {children}
    </fieldset>
  )
}

export function TabStrip<T extends string>({
  tabs,
  active,
  onChange
}: {
  tabs: { id: T; label: string }[]
  active: T
  onChange: (id: T) => void
}) {
  return (
    <div className="flex gap-0.5 border-b border-[#d9d9d9] px-2" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={`-mb-px rounded-t-[2px] border px-3 py-1 text-xs ${
            active === t.id
              ? 'border-[#d9d9d9] border-b-white bg-white text-black'
              : 'border-transparent text-[#333] hover:bg-[#e5f1fb]'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/** Corps gris des boîtes de dialogue classiques. */
export function DialogBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`min-h-0 flex-1 overflow-y-auto bg-[#f0f0f0] p-3 text-xs text-black ${className}`}>
      {children}
    </div>
  )
}

/** Rangée de boutons en bas à droite (OK, Annuler…). */
export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 justify-end gap-2 bg-[#f0f0f0] px-3 pt-1 pb-3">{children}</div>
}

/** Découpe une adresse « a.b.c.d » (éventuellement partielle) en quatre octets. */
function splitIp(value: string): string[] {
  const parts = value.split('.')
  return [0, 1, 2, 3].map((i) => (parts[i] ?? '').replace(/\D/g, '').slice(0, 3))
}

function joinIp(parts: string[]): string {
  return parts.every((p) => p === '') ? '' : parts.join('.')
}

/**
 * Champ d'adresse IPv4 en quatre cases, comme dans les propriétés TCP/IPv4 du système :
 * « . » ou trois chiffres passent à la case suivante, Retour arrière revient à la précédente.
 * Une adresse complète collée (ou saisie dans la première case) est répartie automatiquement.
 */
export function IpBox({
  value,
  onChange,
  disabled = false,
  testId,
  onFocus,
  label
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  testId?: string
  onFocus?: () => void
  label?: string
}) {
  const parts = splitIp(value)
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const focusPart = (i: number) => {
    const el = refs.current[i]
    if (el) {
      el.focus()
      el.select()
    }
  }
  const setPart = (i: number, text: string) => {
    if (text.includes('.')) {
      // Adresse complète : on répartit les octets à partir de cette case
      const pieces = text.split('.').map((p) => p.replace(/\D/g, '').slice(0, 3))
      const next = [...parts]
      pieces.slice(0, 4 - i).forEach((p, k) => (next[i + k] = p))
      onChange(joinIp(next))
      return
    }
    const digits = text.replace(/\D/g, '').slice(0, 3)
    const next = [...parts]
    next[i] = digits
    onChange(joinIp(next))
    if (digits.length === 3 && i < 3) requestAnimationFrame(() => focusPart(i + 1))
  }
  return (
    <div
      className={`flex h-[23px] w-[150px] items-center border px-0.5 ${
        disabled ? 'border-[#cccccc] bg-[#f0f0f0]' : 'border-[#7a7a7a] bg-white focus-within:border-[#0078d7]'
      }`}
      data-testid={testId}
      aria-label={label}
      role="group"
    >
      {parts.map((part, i) => (
        <span key={i} className="flex flex-1 items-center">
          <input
            ref={(el) => {
              refs.current[i] = el
            }}
            value={part}
            disabled={disabled}
            inputMode="numeric"
            aria-label={label ? `${label} (octet ${i + 1})` : undefined}
            onFocus={onFocus}
            onChange={(e) => setPart(i, e.target.value)}
            onKeyDown={(e) => {
              const el = e.currentTarget
              if ((e.key === '.' || e.key === ' ' || e.key === ',') && i < 3) {
                e.preventDefault()
                if (part !== '') focusPart(i + 1)
              } else if (e.key === 'Backspace' && el.selectionStart === 0 && el.selectionEnd === 0 && i > 0) {
                e.preventDefault()
                focusPart(i - 1)
              } else if (e.key === 'ArrowLeft' && el.selectionStart === 0 && i > 0) {
                e.preventDefault()
                focusPart(i - 1)
              } else if (e.key === 'ArrowRight' && el.selectionStart === part.length && i < 3) {
                e.preventDefault()
                focusPart(i + 1)
              }
            }}
            className="w-full min-w-0 bg-transparent text-center font-sans text-xs text-black outline-none disabled:text-[#6d6d6d]"
            data-testid={testId ? `${testId}-${i}` : undefined}
          />
          {i < 3 && <span className={disabled ? 'text-[#a0a0a0]' : 'text-black'}>.</span>}
        </span>
      ))}
    </div>
  )
}

export type MessageIcon = 'error' | 'warning' | 'info' | 'question'

const MESSAGE_ICONS = {
  error: { icon: CircleX, cls: 'text-white fill-[#e81123]' },
  warning: { icon: TriangleAlert, cls: 'text-black fill-[#ffcc00]' },
  info: { icon: Info, cls: 'text-white fill-[#0078d7]' },
  question: { icon: CircleHelp, cls: 'text-white fill-[#0078d7]' }
} as const

export interface MessageButton {
  label: string
  onClick: () => void
  primary?: boolean
  testId?: string
}

/**
 * Boîte de message modale à l'intérieur d'une fenêtre (ou du Bureau) : titre, icône, texte, boutons.
 */
export function MessageBox({
  title,
  message,
  icon = 'info',
  buttons,
  testId = 'msgbox'
}: {
  title: string
  message: ReactNode
  icon?: MessageIcon
  buttons: MessageButton[]
  testId?: string
}) {
  const { icon: Icon, cls } = MESSAGE_ICONS[icon]
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/10" role="alertdialog">
      <div
        className="flex w-[380px] max-w-[92%] flex-col border border-[#8a8a8a] bg-white shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
        data-testid={testId}
      >
        <div className="flex h-7 items-center px-2 text-xs text-black">{title}</div>
        <div className="flex gap-3 bg-white px-4 py-4 text-xs leading-relaxed text-black">
          <Icon size={30} className={`shrink-0 ${cls}`} strokeWidth={1.6} />
          <div className="selectable min-w-0 pt-1 whitespace-pre-line">{message}</div>
        </div>
        <div className="flex justify-end gap-2 bg-[#f0f0f0] px-3 py-2.5">
          {buttons.map((b) => (
            <WinButton
              key={b.label}
              primary={b.primary}
              onClick={b.onClick}
              data-testid={b.testId ?? `${testId}-button`}
            >
              {b.label}
            </WinButton>
          ))}
        </div>
      </div>
    </div>
  )
}
