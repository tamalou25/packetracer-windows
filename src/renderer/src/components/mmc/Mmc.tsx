/**
 * Console d'administration arborescente (style « console de gestion ») :
 * arbre à gauche, contenu au centre, actions à droite.
 */
import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react'
import { useAppWindow } from '../desktop/shell/AppWindow'

export interface MmcNode {
  id: string
  label: string
  icon?: LucideIcon
  /** Classe de couleur de l'icône. */
  iconClass?: string
  children?: MmcNode[]
}

interface MmcProps {
  nodes: MmcNode[]
  selected: string
  onSelect: (id: string) => void
  actions?: ReactNode
  children: ReactNode
  testId?: string
  /** Largeur de l'arborescence (px), à élargir pour les arbres profonds. */
  treeWidth?: number
}

function TreeItem({
  node,
  depth,
  selected,
  onSelect
}: {
  node: MmcNode
  depth: number
  selected: string
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(true)
  const hasChildren = (node.children?.length ?? 0) > 0
  const Icon = node.icon
  return (
    <li>
      <div
        className={`flex cursor-pointer items-center gap-1 rounded py-0.5 pr-2 text-xs ${selected === node.id ? 'bg-sky-100 font-semibold text-sky-900' : 'hover:bg-slate-100'}`}
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={() => onSelect(node.id)}
        data-testid={`mmc-node-${node.id}`}
      >
        <button
          type="button"
          className={`rounded p-0.5 text-slate-400 ${hasChildren ? 'hover:bg-slate-200' : 'invisible'}`}
          onClick={(e) => {
            e.stopPropagation()
            setOpen(!open)
          }}
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        {Icon && <Icon size={13} className={node.iconClass ?? 'text-slate-500'} />}
        <span className="truncate">{node.label}</span>
      </div>
      {hasChildren && open && (
        <ul>
          {node.children?.map((c) => (
            <TreeItem key={c.id} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Libellé du nœud sélectionné (en-tête du volet Actions). */
function findLabel(nodes: MmcNode[], id: string): string | undefined {
  for (const n of nodes) {
    if (n.id === id) return n.label
    const child = n.children ? findLabel(n.children, id) : undefined
    if (child) return child
  }
  return undefined
}

export function Mmc({ nodes, selected, onSelect, actions, children, testId, treeWidth = 224 }: MmcProps) {
  const win = useAppWindow()
  const [menu, setMenu] = useState<'file' | 'action' | 'help' | null>(null)
  const [about, setAbout] = useState(false)
  const menuButton = (id: 'file' | 'action' | 'help', label: string) => (
    <button
      type="button"
      onClick={() => setMenu(menu === id ? null : id)}
      className={`px-2 py-0.5 ${menu === id ? 'bg-[#cce8ff]' : 'hover:bg-[#e5f3ff]'}`}
      data-testid={`mmc-menu-${id}`}
    >
      {label}
    </button>
  )
  return (
    <div className="flex h-full flex-col bg-white" data-testid={testId}>
      {/* Barre de menus de la console */}
      <div className="relative flex shrink-0 border-b border-slate-200 bg-white px-1 text-xs text-black">
        {menuButton('file', 'Fichier')}
        {actions && menuButton('action', 'Action')}
        {menuButton('help', '?')}
        {menu && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenu(null)} />
            <div
              className="absolute top-full z-40 flex w-52 flex-col border border-[#cccccc] bg-[#f2f2f2] py-1 shadow-lg"
              style={{ left: menu === 'file' ? 4 : menu === 'action' ? 52 : actions ? 104 : 52 }}
              onClick={() => setMenu(null)}
            >
              {menu === 'file' && (
                <button
                  type="button"
                  className="px-3 py-1 text-left hover:bg-[#91c9f7]"
                  onClick={() => win?.close()}
                >
                  Quitter
                </button>
              )}
              {menu === 'action' && actions}
              {menu === 'help' && (
                <button
                  type="button"
                  className="px-3 py-1 text-left hover:bg-[#91c9f7]"
                  onClick={() => setAbout(true)}
                >
                  À propos de la console…
                </button>
              )}
            </div>
          </>
        )}
      </div>
      <div className="flex min-h-0 flex-1">
        <ul
          className="shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-1"
          style={{ width: treeWidth }}
        >
          {nodes.map((n) => (
            <TreeItem key={n.id} node={n} depth={0} selected={selected} onSelect={onSelect} />
          ))}
        </ul>
        <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
        {actions && (
          <aside className="w-48 shrink-0 overflow-y-auto border-l border-slate-200 bg-white">
            <div className="border-b border-slate-200 bg-[#f0f0f0] px-2 py-1 text-xs font-semibold text-black">
              Actions
            </div>
            <div className="truncate bg-[#e8e8e8] px-2 py-0.5 text-xs font-semibold text-black">
              {findLabel(nodes, selected) ?? ''}
            </div>
            <div className="flex flex-col gap-0.5 p-1.5">{actions}</div>
          </aside>
        )}
      </div>
      {about && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/10"
          onClick={() => setAbout(false)}
        >
          <div className="w-80 border border-slate-400 bg-white p-4 text-xs text-black shadow-xl">
            Console de gestion simulée (ServerLab). Les composants enfichables reproduisent les consoles
            d’administration d’un serveur, sans exécuter de commande réelle.
          </div>
        </div>
      )}
    </div>
  )
}

/** Bouton du volet Actions. */
export function MmcAction({
  onClick,
  children,
  testId,
  danger
}: {
  onClick: () => void
  children: ReactNode
  testId?: string
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`rounded px-2 py-1 text-left text-xs hover:bg-sky-100 ${danger ? 'text-red-700' : 'text-sky-800'}`}
    >
      {children}
    </button>
  )
}

/** Tableau simple pour le volet central. */
export function MmcTable({
  columns,
  rows,
  empty,
  testId
}: {
  columns: string[]
  rows: ReactNode[][]
  empty: string
  testId?: string
}) {
  return (
    <table className="w-full text-xs" data-testid={testId}>
      <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
        <tr>
          {columns.map((c) => (
            <th key={c} className="border-b border-slate-200 px-3 py-1.5 font-medium">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={columns.length} className="px-3 py-4 text-slate-400">
              {empty}
            </td>
          </tr>
        )}
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
            {r.map((c, j) => (
              <td key={j} className="selectable px-3 py-1.5">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
