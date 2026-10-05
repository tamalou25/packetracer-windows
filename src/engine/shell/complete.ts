/**
 * Complétion Tab : noms de commandes, paramètres et valeurs connues.
 */
import type { LabState } from '../model/schema'
import { CATALOG } from './catalog'
import { CMD_BUILTINS } from './cmd/interpreter'
import { activeShell } from './exec'
import { CmdContext, findCmdlet, findTool } from './ps/interpreter'
import { COMMON_PARAMS } from './ps/registry'
import type { ShellSession } from './types'

export interface Completion {
  /** Portion de la ligne à remplacer. */
  start: number
  end: number
  candidates: string[]
}

const SEPARATORS = new Set([' ', '\t', '|', ';', '(', '{', ','])

function byPrefix(items: string[], prefix: string): string[] {
  const lower = prefix.toLowerCase()
  return [...new Set(items.filter((i) => i.toLowerCase().startsWith(lower)))].sort((a, b) =>
    a.localeCompare(b)
  )
}

function quote(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value
}

export function complete(state: LabState, session: ShellSession, line: string, cursor: number): Completion {
  let start = cursor
  while (start > 0 && !SEPARATORS.has(line[start - 1] as string)) start--
  const token = line.slice(start, cursor)
  const empty: Completion = { start, end: cursor, candidates: [] }

  // Début de l'élément de pipeline courant
  let segStart = start
  while (segStart > 0 && !['|', ';', '(', '{'].includes(line[segStart - 1] as string)) segStart--
  const segment = line.slice(segStart, start).trim()
  const words = segment.length > 0 ? segment.split(/\s+/) : []
  const ctx = new CmdContext(state, session, [], CATALOG, line)

  if (activeShell(session) === 'cmd') {
    if (words.length === 0) {
      const names = [
        ...CATALOG.tools.filter((t) => t.available?.(ctx) ?? true).map((t) => t.name),
        ...CMD_BUILTINS
      ]
      return { ...empty, candidates: byPrefix(names, token) }
    }
    const tool = findTool(CATALOG, words[0] as string)
    if (tool && (token.startsWith('/') || token.startsWith('-')))
      return { ...empty, candidates: byPrefix(tool.switches ?? [], token) }
    return empty
  }

  if (words.length === 0) {
    const names = [
      ...CATALOG.cmdlets.filter((c) => c.available?.(ctx) ?? true).map((c) => c.name),
      ...CATALOG.tools.filter((t) => t.available?.(ctx) ?? true).map((t) => t.name)
    ]
    return { ...empty, candidates: byPrefix(names, token) }
  }
  const def = findCmdlet(CATALOG, words[0] as string)
  if (!def) {
    const tool = findTool(CATALOG, words[0] as string)
    if (tool && (token.startsWith('/') || token.startsWith('-')))
      return { ...empty, candidates: byPrefix(tool.switches ?? [], token) }
    return empty
  }
  if (token.startsWith('-')) {
    const names = [...def.params, ...COMMON_PARAMS].map((p) => `-${p.name}`)
    return { ...empty, candidates: byPrefix(names, token) }
  }
  // Valeur d'un paramètre : propositions du registre
  const previous = words[words.length - 1] ?? ''
  if (previous.startsWith('-')) {
    const p = def.params.find((x) => x.name.toLowerCase() === previous.slice(1).toLowerCase())
    const values = p?.validateSet ?? p?.complete?.(ctx) ?? []
    const bare = token.replace(/^["']/, '')
    return { ...empty, candidates: byPrefix(values, bare).map(quote) }
  }
  return empty
}
