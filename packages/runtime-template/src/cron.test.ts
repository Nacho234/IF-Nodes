import { describe, expect, it } from 'vitest';
import { parseCron, cronMatches, dateFieldsInTimezone, CronScheduler } from './cron';

const UTC = 'UTC';

describe('parseCron', () => {
  it('parsea los 5 campos y expande *', () => {
    const p = parseCron('0 9 * * *')!;
    expect(p.minute.has(0)).toBe(true);
    expect(p.hour.has(9)).toBe(true);
    expect(p.dayOfMonth.size).toBe(31);
    expect(p.month.size).toBe(12);
    expect(p.dayOfWeek.size).toBe(7);
  });
  it('expande rangos, listas y pasos', () => {
    const p = parseCron('*/15 9-17 * * 1,3')!;
    expect([...p.minute].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);
    expect(p.hour.has(9)).toBe(true);
    expect(p.hour.has(17)).toBe(true);
    expect(p.hour.has(8)).toBe(false);
    expect([...p.dayOfWeek].sort()).toEqual([1, 3]);
  });
  it('normaliza domingo 7 → 0', () => {
    expect(parseCron('0 0 * * 7')!.dayOfWeek.has(0)).toBe(true);
  });
  it('rechaza expresiones inválidas', () => {
    expect(parseCron('0 9 * *')).toBeNull();
    expect(parseCron('')).toBeNull();
    expect(parseCron('99 9 * * *')).toBeNull(); // minuto fuera de rango → set vacío
  });
});

describe('dateFieldsInTimezone', () => {
  it('convierte a la zona horaria dada', () => {
    // 2026-07-15T12:00:00Z = 09:00 en Buenos Aires (UTC-3)
    const d = new Date('2026-07-15T12:00:00Z');
    const ba = dateFieldsInTimezone(d, 'America/Argentina/Buenos_Aires');
    expect(ba.hour).toBe(9);
    expect(ba.minute).toBe(0);
    const utc = dateFieldsInTimezone(d, UTC);
    expect(utc.hour).toBe(12);
  });
});

describe('cronMatches', () => {
  it('matchea el minuto/hora exactos en la zona', () => {
    const p = parseCron('0 9 * * *')!;
    // 09:00 BA
    expect(cronMatches(p, new Date('2026-07-15T12:00:00Z'), 'America/Argentina/Buenos_Aires')).toBe(true);
    // 09:01 BA → no
    expect(cronMatches(p, new Date('2026-07-15T12:01:00Z'), 'America/Argentina/Buenos_Aires')).toBe(false);
    // 10:00 BA → no
    expect(cronMatches(p, new Date('2026-07-15T13:00:00Z'), 'America/Argentina/Buenos_Aires')).toBe(false);
  });
  it('OR entre díaMes y díaSemana cuando ambos están restringidos', () => {
    // día 1 del mes O lunes
    const p = parseCron('0 0 1 * 1')!;
    // 2026-07-01 es miércoles → matchea por díaMes
    expect(cronMatches(p, new Date('2026-07-01T00:00:00Z'), UTC)).toBe(true);
    // 2026-07-06 es lunes → matchea por díaSemana
    expect(cronMatches(p, new Date('2026-07-06T00:00:00Z'), UTC)).toBe(true);
    // 2026-07-07 martes, no día 1 → no matchea
    expect(cronMatches(p, new Date('2026-07-07T00:00:00Z'), UTC)).toBe(false);
  });
});

describe('CronScheduler', () => {
  it('dispara el job cuando el cron matchea, una sola vez por minuto', async () => {
    const s = new CronScheduler();
    let fired = 0;
    expect(s.add({ id: 'j1', cron: '0 9 * * *', timezone: UTC, run: () => { fired += 1; } })).toBe(true);
    const at9 = new Date('2026-07-15T09:00:00Z');
    await s.tick(at9);
    await s.tick(new Date('2026-07-15T09:00:30Z')); // mismo minuto → no re-dispara
    expect(fired).toBe(1);
    await s.tick(new Date('2026-07-15T10:00:00Z')); // otra hora → no
    expect(fired).toBe(1);
  });
  it('rechaza cron inválido en add()', () => {
    const s = new CronScheduler();
    expect(s.add({ id: 'bad', cron: 'no', timezone: UTC, run: () => undefined })).toBe(false);
    expect(s.size).toBe(0);
  });
});
