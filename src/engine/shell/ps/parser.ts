/**
 * Analyse syntaxique : instructions, pipelines, commandes et arguments.
 */
import { PsSyntaxError, tokenize, type Token } from './lexer'

export type Expr =
  | { kind: 'number'; value: number; start: number; end: number }
  | { kind: 'string'; value: string; expandable: boolean; bare: boolean; start: number; end: number }
  | { kind: 'variable'; name: string; members: string[]; start: number; end: number }
  | { kind: 'array'; items: Expr[]; start: number; end: number }
  | { kind: 'sub'; statements: Statement[]; members: string[]; start: number; end: number }
  | { kind: 'script'; source: string; start: number; end: number }
  | { kind: 'hash'; entries: { key: string; value: Expr }[]; start: number; end: number }

export type Arg =
  | { kind: 'param'; name: string; inline: Expr | null; text: string; start: number; end: number }
  | { kind: 'value'; expr: Expr; start: number; end: number }

export type Element =
  | { kind: 'command'; name: string; args: Arg[]; start: number; end: number }
  | { kind: 'expr'; expr: Expr; start: number; end: number }

export interface Pipeline {
  elements: Element[]
  start: number
  end: number
}

export interface Statement {
  pipeline: Pipeline
  /** Affectation `$nom = …`. */
  assign: string | null
  start: number
  end: number
}

class Parser {
  private pos = 0
  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)] as Token
  }

  private next(): Token {
    const t = this.peek()
    this.pos++
    return t
  }

  parseStatements(stop: 'eof' | 'rparen'): Statement[] {
    const statements: Statement[] = []
    while (true) {
      while (this.peek().type === 'semi') this.next()
      const t = this.peek()
      if (t.type === 'eof' || t.type === stop) break
      statements.push(this.parseStatement())
      const after = this.peek()
      if (after.type === 'semi') continue
      if (after.type === 'eof' || after.type === stop) break
      throw new PsSyntaxError(
        `Jeton inattendu « ${after.text} » dans l’expression ou l’instruction.`,
        after.start,
        'UnexpectedToken'
      )
    }
    return statements
  }

  private parseStatement(): Statement {
    const first = this.peek()
    let assign: string | null = null
    if (first.type === 'variable' && this.peek(1).type === 'assign' && (first.members ?? []).length === 0) {
      assign = first.value
      this.next()
      this.next()
      const t = this.peek()
      if (t.type === 'eof' || t.type === 'semi')
        throw new PsSyntaxError('Expression manquante après « = ».', t.start, 'ExpectedValueExpression')
    }
    const pipeline = this.parsePipeline()
    return { pipeline, assign, start: first.start, end: pipeline.end }
  }

  private parsePipeline(): Pipeline {
    const elements: Element[] = [this.parseElement()]
    while (this.peek().type === 'pipe') {
      const pipe = this.next()
      const t = this.peek()
      if (t.type === 'eof' || t.type === 'semi' || t.type === 'rparen')
        throw new PsSyntaxError(
          'Un élément de canal vide n’est pas autorisé.',
          pipe.start,
          'EmptyPipeElement'
        )
      elements.push(this.parseElement())
    }
    const first = elements[0] as Element
    const last = elements[elements.length - 1] as Element
    return { elements, start: first.start, end: last.end }
  }

  private parseElement(): Element {
    const t = this.peek()
    if (t.type === 'word') {
      this.next()
      const args: Arg[] = []
      let end = t.end
      while (true) {
        const a = this.peek()
        if (a.type === 'eof' || a.type === 'pipe' || a.type === 'semi' || a.type === 'rparen') break
        if (a.type === 'param') {
          this.next()
          let inline: Expr | null = null
          if (a.inlineValue !== undefined) {
            const sub = tokenize(a.inlineValue)
            const first = sub[0]
            if (first && first.type === 'variable') {
              inline = {
                kind: 'variable',
                name: first.value,
                members: first.members ?? [],
                start: a.start,
                end: a.end
              }
            } else if (first && first.type === 'number') {
              inline = { kind: 'number', value: Number(first.value), start: a.start, end: a.end }
            } else {
              inline = {
                kind: 'string',
                value: a.inlineValue,
                expandable: false,
                bare: true,
                start: a.start,
                end: a.end
              }
            }
          }
          args.push({ kind: 'param', name: a.value, inline, text: a.text, start: a.start, end: a.end })
          end = a.end
        } else {
          const expr = this.parseValue()
          args.push({ kind: 'value', expr, start: expr.start, end: expr.end })
          end = expr.end
        }
      }
      return { kind: 'command', name: t.value, args, start: t.start, end }
    }
    if (t.type === 'param') {
      throw new PsSyntaxError(
        `Jeton inattendu « ${t.text} » dans l’expression ou l’instruction.`,
        t.start,
        'UnexpectedToken'
      )
    }
    const expr = this.parseValue()
    return { kind: 'expr', expr, start: expr.start, end: expr.end }
  }

  /** Valeur éventuellement suivie de virgules (tableau). */
  private parseValue(): Expr {
    const first = this.parsePrimary()
    if (this.peek().type !== 'comma') return first
    const items = [first]
    while (this.peek().type === 'comma') {
      const comma = this.next()
      const t = this.peek()
      if (t.type === 'eof' || t.type === 'pipe' || t.type === 'semi' || t.type === 'rparen')
        throw new PsSyntaxError(
          'Expression manquante après « , » dans la liste de paramètres.',
          comma.start,
          'MissingExpressionAfterToken'
        )
      items.push(this.parsePrimary())
    }
    const last = items[items.length - 1] as Expr
    return { kind: 'array', items, start: first.start, end: last.end }
  }

  private parsePrimary(): Expr {
    const t = this.next()
    switch (t.type) {
      case 'number':
        return { kind: 'number', value: Number(t.value), start: t.start, end: t.end }
      case 'string':
        return {
          kind: 'string',
          value: t.value,
          expandable: !!t.expandable,
          bare: false,
          start: t.start,
          end: t.end
        }
      case 'word':
        return { kind: 'string', value: t.value, expandable: false, bare: true, start: t.start, end: t.end }
      case 'variable':
        return { kind: 'variable', name: t.value, members: t.members ?? [], start: t.start, end: t.end }
      case 'script':
        return { kind: 'script', source: t.value, start: t.start, end: t.end }
      case 'hash':
        return { kind: 'hash', entries: parseHashEntries(t.value, t.start), start: t.start, end: t.end }
      case 'lparen':
      case 'atparen': {
        const statements = this.parseStatements('rparen')
        const close = this.peek()
        if (close.type !== 'rparen')
          throw new PsSyntaxError(
            'Parenthèse fermante « ) » manquante dans l’expression.',
            close.start,
            'MissingEndParenthesisInExpression'
          )
        this.next()
        // Accès membre collé : (expression).Propriété
        const members: string[] = []
        let end = close.end
        while (this.peek().type === 'word' && this.peek().start === end && this.peek().text.startsWith('.')) {
          const m = this.next()
          members.push(...m.text.split('.').filter((x) => x.length > 0))
          end = m.end
        }
        if (t.type === 'atparen' && statements.length === 0)
          return { kind: 'array', items: [], start: t.start, end }
        return { kind: 'sub', statements, members, start: t.start, end }
      }
      default:
        throw new PsSyntaxError(
          t.type === 'eof'
            ? 'Expression manquante.'
            : `Jeton inattendu « ${t.text} » dans l’expression ou l’instruction.`,
          t.start,
          t.type === 'eof' ? 'ExpectedExpression' : 'UnexpectedToken'
        )
    }
  }
}

/** Découpe le contenu d'une table de hachage en entrées « clé = valeur » (séparées par ; ou retour). */
function parseHashEntries(source: string, offset: number): { key: string; value: Expr }[] {
  const parts: string[] = []
  let current = ''
  let quote: string | null = null
  let depth = 0
  for (const c of source) {
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (c === '(' || c === '{') depth++
    else if (c === ')' || c === '}') depth--
    else if ((c === ';' || c === '\n') && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += c
  }
  parts.push(current)
  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => {
      const eq = p.indexOf('=')
      if (eq <= 0)
        throw new PsSyntaxError(
          'Signe égal (=) manquant après la clé dans le littéral de hachage.',
          offset,
          'MissingEqualsInHashLiteral'
        )
      const key = p
        .slice(0, eq)
        .trim()
        .replace(/^['"]|['"]$/g, '')
      const statements = parse(p.slice(eq + 1))
      const element = statements[0]?.pipeline.elements[0]
      if (!element || element.kind !== 'expr')
        throw new PsSyntaxError(
          'Expression manquante dans le littéral de hachage.',
          offset,
          'MissingHashValue'
        )
      return { key, value: element.expr }
    })
}

export function parse(source: string): Statement[] {
  const parser = new Parser(tokenize(source))
  return parser.parseStatements('eof')
}
