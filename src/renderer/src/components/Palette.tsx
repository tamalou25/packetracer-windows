/**
 * Palette d'équipements (panneau de gauche, rétractable) : groupes repliables, recherche.
 * Glisser un équipement vers le canvas, ou cliquer dessus puis cliquer sur le canvas.
 */
import { useMemo, useState, type DragEvent } from 'react'
import { ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen, Search, X } from 'lucide-react'
import { DEVICE_KIND_INFO, type DeviceKind } from '@engine/index'
import { DEVICE_ICONS, KIND_STRIPE } from '../lib/devices'
import { readPref, writePref } from '../lib/prefs'
import { useUiStore } from '../store/ui'

/** Type MIME utilisé pour le glisser-déposer depuis la palette. */
export const DND_DEVICE_MIME = 'application/x-serverlab-device'

interface PaletteGroup {
  id: string
  label: string
  kinds: DeviceKind[]
}

const GROUPS: PaletteGroup[] = [
  { id: 'servers', label: 'Serveurs', kinds: ['server'] },
  { id: 'clients', label: 'Postes', kinds: ['client'] },
  { id: 'network', label: 'Réseau', kinds: ['switch', 'router'] },
  { id: 'internet', label: 'Internet', kinds: ['cloud'] }
]

/** Modèle affiché sous le nom de l'équipement. */
const MODELS: Record<DeviceKind, string> = {
  server: '1 à 4 cartes réseau',
  client: 'Poste de travail · 1 carte',
  switch: 'Niveau 2 · 16 ports Fa0/x',
  router: 'Statique · 4 ports Gi0/x',
  cloud: 'FAI simulé · port WAN'
}

/** Comparaison insensible à la casse et aux accents. */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

interface PaletteState {
  collapsed: boolean
  closedGroups: string[]
}

const DEFAULT_STATE: PaletteState = { collapsed: false, closedGroups: [] }

function startDrag(e: DragEvent, kind: DeviceKind) {
  e.dataTransfer.setData(DND_DEVICE_MIME, kind)
  e.dataTransfer.effectAllowed = 'copy'
}

export function Palette() {
  const armed = useUiStore((s) => s.armed)
  const setArmed = useUiStore((s) => s.setArmed)
  const [state, setState] = useState<PaletteState>(() => readPref('palette', DEFAULT_STATE))
  const [query, setQuery] = useState('')
  const update = (patch: Partial<PaletteState>) => {
    const next = { ...state, ...patch }
    setState(next)
    writePref('palette', next)
  }

  const matches = useMemo(() => {
    const q = normalize(query.trim())
    if (!q) return null
    return new Set(
      (Object.keys(DEVICE_KIND_INFO) as DeviceKind[]).filter((k) =>
        normalize(`${DEVICE_KIND_INFO[k].label} ${MODELS[k]} ${DEVICE_KIND_INFO[k].description}`).includes(q)
      )
    )
  }, [query])

  const arm = (kind: DeviceKind) => setArmed(armed === kind ? null : kind)

  if (state.collapsed) {
    return (
      <aside
        className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-2"
        aria-label="Palette d’équipements"
        data-testid="palette"
      >
        <button
          type="button"
          onClick={() => update({ collapsed: false })}
          className="mb-1 rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
          title="Déplier la palette"
          data-testid="palette-toggle"
        >
          <PanelLeftOpen size={16} />
        </button>
        {GROUPS.flatMap((g) => g.kinds).map((kind) => {
          const Icon = DEVICE_ICONS[kind]
          return (
            <button
              key={kind}
              type="button"
              draggable
              onDragStart={(e) => startDrag(e, kind)}
              onClick={() => arm(kind)}
              aria-pressed={armed === kind}
              title={`${DEVICE_KIND_INFO[kind].label} — ${MODELS[kind]}`}
              data-testid={`palette-${kind}`}
              className={`relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-md border transition-colors ${
                armed === kind
                  ? 'border-accent bg-accent-soft text-accent-text'
                  : 'border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg'
              }`}
            >
              <span className={`absolute inset-y-0 left-0 w-[2px] ${KIND_STRIPE[kind]}`} />
              <Icon size={16} strokeWidth={1.6} />
            </button>
          )
        })}
      </aside>
    )
  }

  return (
    <aside
      className="flex w-[220px] shrink-0 flex-col border-r border-line bg-panel"
      aria-label="Palette d’équipements"
      data-testid="palette"
    >
      <div className="flex h-9 items-center justify-between border-b border-line pr-1.5 pl-3">
        <span className="text-[11px] font-semibold tracking-wider text-fg-subtle uppercase">Équipements</span>
        <button
          type="button"
          onClick={() => update({ collapsed: true })}
          className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
          title="Replier la palette"
          data-testid="palette-toggle"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>
      <div className="px-2 pt-2 pb-1">
        <label className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-fg-subtle focus-within:border-accent">
          <Search size={13} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher…"
            className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-subtle"
            data-testid="palette-search"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} title="Effacer" className="hover:text-fg">
              <X size={12} />
            </button>
          )}
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {GROUPS.map((group) => {
          const kinds = group.kinds.filter((k) => !matches || matches.has(k))
          if (kinds.length === 0) return null
          // Une recherche en cours déplie les groupes concernés
          const open = !!matches || !state.closedGroups.includes(group.id)
          return (
            <section key={group.id} className="mt-1">
              <button
                type="button"
                onClick={() =>
                  update({
                    closedGroups: open
                      ? [...state.closedGroups, group.id]
                      : state.closedGroups.filter((g) => g !== group.id)
                  })
                }
                className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-[11px] font-semibold tracking-wider text-fg-subtle uppercase hover:text-fg-muted"
                aria-expanded={open}
                data-testid={`palette-group-${group.id}`}
              >
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {group.label}
                <span className="ml-auto font-normal">{kinds.length}</span>
              </button>
              {open && (
                <ul className="flex flex-col gap-0.5">
                  {kinds.map((kind) => {
                    const Icon = DEVICE_ICONS[kind]
                    const active = armed === kind
                    return (
                      <li key={kind}>
                        <button
                          type="button"
                          draggable
                          onDragStart={(e) => startDrag(e, kind)}
                          onClick={() => arm(kind)}
                          aria-pressed={active}
                          title={`${DEVICE_KIND_INFO[kind].description} — glisser vers le canvas`}
                          data-testid={`palette-${kind}`}
                          className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors ${
                            active ? 'bg-accent-soft ring-1 ring-accent' : 'hover:bg-surface-2'
                          }`}
                        >
                          <span className="relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-surface text-fg-muted">
                            <span className={`absolute inset-y-0 left-0 w-[2px] ${KIND_STRIPE[kind]}`} />
                            <Icon size={15} strokeWidth={1.6} />
                          </span>
                          <span className="min-w-0 leading-tight">
                            <span className="block truncate text-[13px] text-fg">
                              {DEVICE_KIND_INFO[kind].label}
                            </span>
                            <span className="block truncate text-[11px] text-fg-muted">{MODELS[kind]}</span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )
        })}
        {matches && matches.size === 0 && (
          <p className="px-2 py-4 text-center text-xs text-fg-subtle">Aucun équipement ne correspond.</p>
        )}
      </div>
      <p className="border-t border-line px-3 py-2 text-[11px] leading-snug text-fg-subtle">
        Glissez un équipement sur le canvas, ou cliquez-le puis cliquez sur le canvas.
      </p>
    </aside>
  )
}
