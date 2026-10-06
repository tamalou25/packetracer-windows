/**
 * Mini-évaluateur d'expressions de comparaison, utilisé par :
 *  - Where-Object { $_.Name -like 'J*' -and $_.Enabled }
 *  - les filtres Active Directory (-Filter "Name -like 'J*'")
 */
import { PsSyntaxError, tokenize, type Token } from './lexer'
import { getProp, psEquals, psLike, psToBool, psToString, type PsValue } from './values'

export interface ExpressionScope {
  /** Valeur d'une variable ($_, $true…). */
  variable: (name: string) => PsValue
  /** Interprétation d'un mot nu (propriété de l'objet pour un filtre AD, sinon chaîne). */
  bare: (word: string) => PsValue
}

const COMPARATORS = new Set([
  'eq',
  'ne',
  'like',
  'notlike',
  'match',
  'notmatch',
  'gt',
  'ge',
  'lt',
  'le',
  'contains',
  'notcontains',
  'in',
  'notin'
])

function compareNumbers(a: PsValue, b: PsValue): number {
  const na = Number(psToString(a))
  const nb = Number(psToString(b))
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
  return psToString(a).localeCompare(psToString(b), 'fr', { sensitivity: 'base' })
}

export function compare(op: string, left: PsValue, right: PsValue): boolean {
  switch (op) {
    case 'eq':
      return Array.isArray(left) ? left.some((l) => psEquals(l, right)) : psEquals(left, right)
    case 'ne':
      return !psEquals(left, right)
    case 'like':
      return psLike(left, right)
    case 'notlike':
      return !psLike(left, right)
    case 'match':
      return new RegExp(psToString(right), 'i').test(psToString(left))
    case 'notmatch':
      return !new RegExp(psToString(right), 'i').test(psToString(left))
    case 'gt':
      return compareNumbers(left, right) > 0
    case 'ge':
      return compareNumbers(left, right) >= 0
    case 'lt':
      return compareNumbers(left, right) < 0
    case 'le':
      return compareNumbers(left, right) <= 0
    case 'contains':
      return Array.isArray(left) ? left.some((l) => psEquals(l, right)) : psEquals(left, right)
    case 'notcontains':
      return !(Array.isArray(left) ? left.some((l) => psEquals(l, right)) : psEquals(left, right))
    case 'in':
      return Array.isArray(right) ? right.some((r) => psEquals(left, r)) : psEquals(left, right)
    case 'notin':
      return !(Array.isArray(right) ? right.some((r) => psEquals(left, r)) : psEquals(left, right))
    default:
      return false
  }
}

class ExprParser {
  private pos = 0
  constructor(
    private readonly tokens: Token[],
    private readonly scope: ExpressionScope
  ) {}

  private peek(): Token {
    return this.tokens[Math.min(this.pos, this.tokens.length - 1)] as Token
  }

  private next(): Token {
    return this.tokens[this.pos++] as Token
  }

  evaluate(): PsValue {
    const v = this.or()
    const t = this.peek()
    if (t.type !== 'eof')
      throw new PsSyntaxError(`Jeton inattendu « ${t.text} » dans l’expression.`, t.start, 'UnexpectedToken')
    return v
  }

  private isOp(name: string): boolean {
    const t = this.peek()
    return t.type === 'param' && t.value.toLowerCase() === name
  }

  private or(): PsValue {
    let left = this.and()
    while (this.isOp('or')) {
      this.next()
      const right = this.and()
      left = psToBool(left) || psToBool(right)
    }
    return left
  }

  private and(): PsValue {
    let left = this.not()
    while (this.isOp('and')) {
      this.next()
      const right = this.not()
      left = psToBool(left) && psToBool(right)
    }
    return left
  }

  private not(): PsValue {
    if (this.isOp('not') || (this.peek().type === 'word' && this.peek().text === '!')) {
      this.next()
      return !psToBool(this.not())
    }
    return this.comparison()
  }

  private comparison(): PsValue {
    const left = this.list(true)
    const t = this.peek()
    if (t.type === 'param' && COMPARATORS.has(t.value.toLowerCase())) {
      this.next()
      const right = this.list(false)
      return compare(t.value.toLowerCase(), left, right)
    }
    return left
  }

  /** Opérande ou liste séparée par des virgules ('a','b' : tableau, prioritaire sur les comparaisons). */
  private list(leftSide: boolean): PsValue {
    const first = this.operand(leftSide)
    if (this.peek().type !== 'comma') return first
    const items: PsValue[] = [first]
    while (this.peek().type === 'comma') {
      this.next()
      items.push(this.operand(leftSide))
    }
    return items
  }

  private operand(leftSide: boolean): PsValue {
    const t = this.next()
    switch (t.type) {
      case 'variable': {
        let v = this.scope.variable(t.value)
        for (const m of t.members ?? []) v = getProp(v, m)
        return v
      }
      case 'string':
        return t.value
      case 'number':
        return Number(t.value)
      case 'word':
        return leftSide ? this.scope.bare(t.value) : t.value
      case 'lparen': {
        const v = this.or()
        if (this.peek().type !== 'rparen')
          throw new PsSyntaxError(
            'Parenthèse fermante « ) » manquante dans l’expression.',
            this.peek().start,
            'MissingEndParenthesisInExpression'
          )
        this.next()
        return v
      }
      default:
        throw new PsSyntaxError(
          `Expression manquante (« ${t.text || 'fin de ligne'} »).`,
          t.start,
          'ExpectedExpression'
        )
    }
  }
}

/** Évalue une expression de filtre. */
export function evaluateExpression(source: string, scope: ExpressionScope): PsValue {
  return new ExprParser(tokenize(source), scope).evaluate()
}
