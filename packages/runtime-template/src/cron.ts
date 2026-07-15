/**
 * Scheduler minimalista del runtime exportado. Interpreta expresiones cron
 * estándar de 5 campos (min hora díaMes mes díaSemana) y dispara callbacks
 * cuando el minuto actual coincide. Sin dependencias externas (va bundled).
 * Respeta la zona horaria IANA del nodo "Programado (cron)".
 */

/** Expande un campo cron (p.ej. "*", "1-5", "*\/15", "1,3,5") al set de valores. */
function expandField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isFinite(step) || step < 1) continue;
    let lo = min;
    let hi = max;
    if (rangePart !== '*' && rangePart !== undefined) {
      const [a, b] = rangePart.split('-');
      lo = Number(a);
      hi = b !== undefined ? Number(b) : lo;
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    }
    for (let v = lo; v <= hi; v += step) {
      if (v >= min && v <= max) out.add(v);
    }
  }
  return out;
}

export interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
}

/** Parsea "min hora díaMes mes díaSemana". Devuelve null si es inválida. */
export function parseCron(expr: string): ParsedCron | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [m, h, dom, mon, dow] = fields;
  const parsed: ParsedCron = {
    minute: expandField(m!, 0, 59),
    hour: expandField(h!, 0, 23),
    dayOfMonth: expandField(dom!, 1, 31),
    month: expandField(mon!, 1, 12),
    // Normalizamos 7 → 0 (ambos = domingo)
    dayOfWeek: new Set([...expandField(dow!, 0, 7)].map((d) => (d === 7 ? 0 : d))),
  };
  if ([parsed.minute, parsed.hour, parsed.dayOfMonth, parsed.month, parsed.dayOfWeek].some((s) => s.size === 0)) {
    return null;
  }
  return parsed;
}

/** Campos de fecha (min/hora/día/mes/díaSemana) en una zona horaria dada. */
export function dateFieldsInTimezone(date: Date, timezone: string): {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    minute: '2-digit',
    hour: '2-digit',
    day: '2-digit',
    month: '2-digit',
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    minute: Number(parts.minute),
    // "24" en algunos entornos para medianoche → 0
    hour: Number(parts.hour) % 24,
    dayOfMonth: Number(parts.day),
    month: Number(parts.month),
    dayOfWeek: weekdayMap[parts.weekday ?? 'Sun'] ?? 0,
  };
}

/**
 * ¿La expresión cron dispara en este instante (resolución de minuto)?
 * Regla cron estándar: si díaMes y díaSemana están ambos restringidos, matchea
 * cualquiera de los dos (OR); si uno es "*", vale solo el otro.
 */
export function cronMatches(parsed: ParsedCron, date: Date, timezone: string): boolean {
  const f = dateFieldsInTimezone(date, timezone);
  if (!parsed.minute.has(f.minute)) return false;
  if (!parsed.hour.has(f.hour)) return false;
  if (!parsed.month.has(f.month)) return false;
  const domRestricted = parsed.dayOfMonth.size < 31;
  const dowRestricted = parsed.dayOfWeek.size < 7;
  const domOk = parsed.dayOfMonth.has(f.dayOfMonth);
  const dowOk = parsed.dayOfWeek.has(f.dayOfWeek);
  if (domRestricted && dowRestricted) return domOk || dowOk;
  return domOk && dowOk;
}

export interface CronJob {
  id: string;
  cron: string;
  timezone: string;
  run: (firedAt: Date) => Promise<void> | void;
}

/**
 * Corre jobs cron chequeando una vez por minuto. Evita doble disparo dentro del
 * mismo minuto guardando la última marca "YYYY-MM-DDTHH:MM" ejecutada por job.
 */
export class CronScheduler {
  private jobs: { job: CronJob; parsed: ParsedCron }[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastFired = new Map<string, string>();

  add(job: CronJob): boolean {
    const parsed = parseCron(job.cron);
    if (!parsed) return false;
    this.jobs.push({ job, parsed });
    return true;
  }

  get size(): number {
    return this.jobs.length;
  }

  /** Chequea todos los jobs contra "ahora" (o una fecha dada, para tests). */
  async tick(now: Date = new Date()): Promise<void> {
    for (const { job, parsed } of this.jobs) {
      if (!cronMatches(parsed, now, job.timezone)) continue;
      const stamp = minuteStamp(now, job.timezone);
      if (this.lastFired.get(job.id) === stamp) continue;
      this.lastFired.set(job.id, stamp);
      await job.run(now);
    }
  }

  start(): void {
    if (this.timer || this.jobs.length === 0) return;
    // Chequeo cada 30s para no perder el borde del minuto
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, 30_000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

function minuteStamp(date: Date, timezone: string): string {
  const f = dateFieldsInTimezone(date, timezone);
  return `${f.month}-${f.dayOfMonth}-${f.hour}-${f.minute}`;
}
