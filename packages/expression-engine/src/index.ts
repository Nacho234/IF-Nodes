/**
 * Motor de expresiones {{ ... }} — SIN eval, sin new Function.
 *
 * Gramática soportada (recursive descent):
 *   expresión := funcion | path | literal
 *   funcion   := ident '(' [expresión (',' expresión)*] ')'
 *   path      := ident ('.' ident | '[' número ']')*
 *   literal   := "texto" | 'texto' | número | true | false | null
 *
 * Acceso al contexto solo por paths explícitos y whitelist de funciones.
 */

export class ExpressionError extends Error {
  constructor(
    message: string,
    readonly expression: string,
  ) {
    super(`${message} — en «${expression}»`);
    this.name = 'ExpressionError';
  }
}

type Ctx = Record<string, unknown>;

/* ── Funciones permitidas (whitelist) ───────────────────────── */

type ExprFn = (args: unknown[], raw: string) => unknown;

function str(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function toDate(value: unknown, raw: string): Date {
  const date =
    value instanceof Date ? value : new Date(typeof value === 'number' ? value : String(value));
  if (Number.isNaN(date.getTime())) throw new ExpressionError('Fecha inválida', raw);
  return date;
}

const FUNCTIONS: Record<string, ExprFn> = {
  uppercase: ([v]) => str(v).toUpperCase(),
  lowercase: ([v]) => str(v).toLowerCase(),
  trim: ([v]) => str(v).trim(),
  default: ([v, fallback]) => (v === null || v === undefined || v === '' ? fallback : v),
  contains: ([haystack, needle]) => {
    if (Array.isArray(haystack)) return haystack.includes(needle);
    return str(haystack).includes(str(needle));
  },
  length: ([v]) => {
    if (Array.isArray(v)) return v.length;
    if (v && typeof v === 'object') return Object.keys(v).length;
    return str(v).length;
  },
  number: ([v], raw) => {
    const n = Number(v);
    if (Number.isNaN(n)) throw new ExpressionError(`«${str(v)}» no es un número`, raw);
    return n;
  },
  string: ([v]) => str(v),
  json: ([v], raw) => {
    if (typeof v === 'string') {
      try {
        return JSON.parse(v);
      } catch {
        throw new ExpressionError('JSON inválido', raw);
      }
    }
    return v;
  },
  formatDate: ([v, format], raw) => {
    const date = toDate(v ?? new Date(), raw);
    const pad = (n: number) => String(n).padStart(2, '0');
    const map: Record<string, string> = {
      YYYY: String(date.getFullYear()),
      MM: pad(date.getMonth() + 1),
      DD: pad(date.getDate()),
      HH: pad(date.getHours()),
      mm: pad(date.getMinutes()),
      ss: pad(date.getSeconds()),
    };
    const pattern = typeof format === 'string' && format ? format : 'YYYY-MM-DD';
    return pattern.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => map[token] ?? token);
  },
  addDays: ([v, days], raw) => {
    const date = toDate(v, raw);
    const result = new Date(date);
    result.setDate(result.getDate() + Number(days ?? 0));
    return result.toISOString();
  },
  subtractDays: ([v, days], raw) => {
    const date = toDate(v, raw);
    const result = new Date(date);
    result.setDate(result.getDate() - Number(days ?? 0));
    return result.toISOString();
  },
};

export const AVAILABLE_FUNCTIONS = Object.keys(FUNCTIONS);

/* ── Parser ─────────────────────────────────────────────────── */

class Parser {
  private pos = 0;
  constructor(
    private readonly src: string,
    private readonly ctx: Ctx,
  ) {}

  parse(): unknown {
    const value = this.parseExpression();
    this.skipSpaces();
    if (this.pos < this.src.length) {
      throw new ExpressionError(`Símbolo inesperado «${this.src[this.pos]}»`, this.src);
    }
    return value;
  }

  private skipSpaces(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos] as string)) this.pos++;
  }

  private parseExpression(): unknown {
    this.skipSpaces();
    const ch = this.src[this.pos];
    if (ch === undefined) throw new ExpressionError('Expresión vacía', this.src);
    if (ch === '"' || ch === "'") return this.parseString(ch);
    if (/[0-9-]/.test(ch)) return this.parseNumber();
    if (/[A-Za-z_]/.test(ch)) return this.parseIdentifierBased();
    throw new ExpressionError(`Símbolo inesperado «${ch}»`, this.src);
  }

  private parseString(quote: string): string {
    this.pos++; // abre comilla
    let out = '';
    while (this.pos < this.src.length && this.src[this.pos] !== quote) {
      if (this.src[this.pos] === '\\' && this.src[this.pos + 1] === quote) this.pos++;
      out += this.src[this.pos];
      this.pos++;
    }
    if (this.src[this.pos] !== quote) throw new ExpressionError('Falta cerrar comillas', this.src);
    this.pos++;
    return out;
  }

  private parseNumber(): number {
    const match = /^-?\d+(\.\d+)?/.exec(this.src.slice(this.pos));
    if (!match) throw new ExpressionError('Número inválido', this.src);
    this.pos += match[0].length;
    return Number(match[0]);
  }

  private parseIdentifierBased(): unknown {
    const start = this.pos;
    while (this.pos < this.src.length && /[A-Za-z0-9_]/.test(this.src[this.pos] as string)) this.pos++;
    const ident = this.src.slice(start, this.pos);

    if (ident === 'true') return true;
    if (ident === 'false') return false;
    if (ident === 'null') return null;

    this.skipSpaces();
    if (this.src[this.pos] === '(') return this.parseCall(ident);
    return this.parsePath(ident);
  }

  private parseCall(name: string): unknown {
    const fn = FUNCTIONS[name];
    if (!fn) {
      throw new ExpressionError(
        `Función desconocida «${name}» (disponibles: ${AVAILABLE_FUNCTIONS.join(', ')})`,
        this.src,
      );
    }
    this.pos++; // (
    const args: unknown[] = [];
    this.skipSpaces();
    if (this.src[this.pos] !== ')') {
      for (;;) {
        args.push(this.parseExpression());
        this.skipSpaces();
        if (this.src[this.pos] === ',') {
          this.pos++;
          continue;
        }
        break;
      }
    }
    if (this.src[this.pos] !== ')') throw new ExpressionError(`Falta cerrar «)» en ${name}()`, this.src);
    this.pos++;
    return fn(args, this.src);
  }

  private parsePath(firstSegment: string): unknown {
    // Acceso seguro por propiedades propias; nunca prototipos ni funciones.
    const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
    let current: unknown = Object.prototype.hasOwnProperty.call(this.ctx, firstSegment)
      ? this.ctx[firstSegment]
      : undefined;
    if (FORBIDDEN.has(firstSegment)) return undefined;

    for (;;) {
      if (this.src[this.pos] === '.') {
        this.pos++;
        const start = this.pos;
        while (this.pos < this.src.length && /[A-Za-z0-9_]/.test(this.src[this.pos] as string)) this.pos++;
        const segment = this.src.slice(start, this.pos);
        if (!segment) throw new ExpressionError('Path incompleto después de «.»', this.src);
        current = this.access(current, segment, FORBIDDEN);
      } else if (this.src[this.pos] === '[') {
        this.pos++;
        const index = this.parseNumber();
        if (this.src[this.pos] !== ']') throw new ExpressionError('Falta cerrar «]»', this.src);
        this.pos++;
        current = Array.isArray(current) ? current[index] : undefined;
      } else {
        break;
      }
    }
    return current;
  }

  private access(target: unknown, key: string, forbidden: Set<string>): unknown {
    if (forbidden.has(key)) return undefined;
    if (target === null || target === undefined) return undefined;
    if (typeof target !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(target, key)) return undefined;
    const value = (target as Record<string, unknown>)[key];
    return typeof value === 'function' ? undefined : value;
  }
}

/** Evalúa una expresión pura (sin llaves): `evaluateExpression('trigger.text', ctx)` */
export function evaluateExpression(expression: string, context: Ctx): unknown {
  return new Parser(expression, context).parse();
}

const TEMPLATE_PATTERN = /\{\{([^{}]+)\}\}/g;

/**
 * Resuelve una plantilla:
 * - si el string ES una única expresión ("{{trigger.data}}") devuelve el valor crudo
 *   (objetos incluidos);
 * - si tiene texto alrededor, interpola como string.
 */
export function resolveTemplate(template: string, context: Ctx): unknown {
  const trimmed = template.trim();
  const single = /^\{\{([^{}]+)\}\}$/.exec(trimmed);
  if (single) return evaluateExpression(single[1] as string, context);
  return template.replace(TEMPLATE_PATTERN, (_match, expr: string) =>
    str(evaluateExpression(expr, context)),
  );
}

/** Resuelve recursivamente todas las plantillas de un valor de config (JSON-like). */
export function resolveDeep(value: unknown, context: Ctx): unknown {
  if (typeof value === 'string') return resolveTemplate(value, context);
  if (Array.isArray(value)) return value.map((item) => resolveDeep(item, context));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = resolveDeep(item, context);
    return out;
  }
  return value;
}

/** true si el string contiene al menos una expresión {{ ... }} */
export function hasExpressions(value: string): boolean {
  return /\{\{[^{}]+\}\}/.test(value);
}
