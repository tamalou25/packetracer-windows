/**
 * Console d'administration arborescente (style « console de gestion ») :
 * arbre à gauche, contenu au centre, actions à droite.
 */
import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react'

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

export function Mmc({ nodes, selected, onSelect, actions, children, testId }: MmcProps) {
  return (
    <div className="flex h-full bg-white" data-testid={testId}>
      <ul className="w-56 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-1">
        {nodes.map((n) => (
          <TreeItem key={n.id} node={n} depth={0} selected={selected} onSelect={onSelect} />
        ))}
      </ul>
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
      {actions && (
        <aside className="w-44 shrink-0 overflow-y-auto border-l border-slate-200 bg-slate-50 p-2">
          <div className="mb-1 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">Actions</div>
          <div className="flex flex-col gap-1">{actions}</div>
        </aside>
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
