/**
 * Erreurs PowerShell et leur affichage (ErrorRecord).
 */

export interface PsErrorInfo {
  message: string
  /** Catégorie (ObjectNotFound, InvalidArgument, …). */
  category: string
  /** Identifiant (CommandNotFoundException, NamedParameterNotFound…). */
  errorId: string
  /** Type d'exception affiché dans CategoryInfo. */
  exception?: string
  /** Objet ciblé affiché dans CategoryInfo. */
  target?: string
}

/** Erreur levée pendant l'exécution d'une commande. */
export class PsError extends Error {
  /** Portion de la ligne soulignée (~~~). */
  span?: { start: number; end: number }
  /** Nom de commande affiché en préfixe (si différent de la commande en cours). */
  command?: string

  constructor(public readonly info: PsErrorInfo) {
    super(info.message)
    this.name = 'PsError'
  }
}

export function psError(
  message: string,
  category: string,
  errorId: string,
  target?: string,
  exception?: string
): PsError {
  return new PsError({
    message,
    category,
    errorId,
    ...(target !== undefined ? { target } : {}),
    ...(exception ? { exception } : {})
  })
}

/**
 * Formate une erreur à la manière de la console :
 *   Commande : message
 *   Au caractère Ligne:1 : 12
 *   + ligne
 *   +            ~~~~
 *       + CategoryInfo          : …
 *       + FullyQualifiedErrorId : …
 */
export function formatPsError(
  info: PsErrorInfo,
  source: string,
  span: { start: number; end: number },
  command: string | null
): string[] {
  const start = Math.max(0, Math.min(span.start, source.length))
  const len = Math.max(1, Math.min(span.end, source.length) - start)
  const lines = [command ? `${command} : ${info.message}` : info.message]
  lines.push(`Au caractère Ligne:1 : ${start + 1}`)
  lines.push(`+ ${source}`)
  lines.push(`+ ${' '.repeat(start)}${'~'.repeat(len)}`)
  const target = info.target ?? ''
  const exception = info.exception ?? info.errorId
  lines.push(
    `    + CategoryInfo          : ${info.category}: (${target}${target ? ':String' : ':'}) [${command ?? ''}], ${exception}`
  )
  lines.push(`    + FullyQualifiedErrorId : ${info.errorId}${command ? `,${command}` : ''}`)
  lines.push('')
  return lines
}
