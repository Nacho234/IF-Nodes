import { describe, expect, it } from 'vitest';
import { shouldReplyToEmail, authResult } from './should-reply';

const ok = { from: 'ana@agencia.com', subject: 'Consulta sobre el festival' };

describe('shouldReplyToEmail', () => {
  it('contesta a una persona real', () => {
    expect(shouldReplyToEmail(ok).reply).toBe(true);
  });

  it('NO contesta un out-of-office (el bucle infinito clásico)', () => {
    expect(shouldReplyToEmail({ ...ok, headers: { 'auto-submitted': 'auto-replied' } })).toEqual({
      reply: false, reason: 'auto-submitted',
    });
    expect(shouldReplyToEmail({ ...ok, subject: 'Out of Office: Re: FePI' }).reply).toBe(false);
    expect(shouldReplyToEmail({ ...ok, subject: 'Fuera de la oficina' }).reply).toBe(false);
    expect(shouldReplyToEmail({ ...ok, subject: 'Respuesta automática: consulta' }).reply).toBe(false);
    expect(shouldReplyToEmail({ ...ok, subject: 'Re: Respuesta automatica' }).reply).toBe(false);
    expect(shouldReplyToEmail({ ...ok, subject: 'Automatic reply: FePI' }).reply).toBe(false);
  });

  it('auto-submitted: no SÍ es un mail humano', () => {
    expect(shouldReplyToEmail({ ...ok, headers: { 'auto-submitted': 'no' } }).reply).toBe(true);
  });

  it('NO contesta rebotes', () => {
    expect(shouldReplyToEmail({ ...ok, from: 'mailer-daemon@donweb.com' }).reply).toBe(false);
    expect(shouldReplyToEmail({ ...ok, headers: { 'return-path': '<>' } })).toEqual({ reply: false, reason: 'rebote' });
    expect(shouldReplyToEmail({ ...ok, subject: 'Undelivered Mail Returned to Sender' }).reply).toBe(false);
    expect(shouldReplyToEmail({ ...ok, subject: 'Delivery Status Notification (Failure)' }).reply).toBe(false);
  });

  it('NO contesta newsletters ni listas', () => {
    expect(shouldReplyToEmail({ ...ok, headers: { precedence: 'bulk' } }).reply).toBe(false);
    expect(shouldReplyToEmail({ ...ok, headers: { 'list-unsubscribe': '<mailto:x>' } })).toEqual({
      reply: false, reason: 'lista_de_correo',
    });
  });

  it('NO contesta a remitentes automáticos', () => {
    for (const f of ['noreply@x.com', 'no-reply@x.com', 'postmaster@x.com', 'bounces@x.com', 'notifications@x.com']) {
      expect(shouldReplyToEmail({ ...ok, from: f }).reply, f).toBe(false);
    }
  });

  it('NO contesta a Exchange con supresión de auto-respuesta', () => {
    expect(shouldReplyToEmail({ ...ok, headers: { 'x-auto-response-suppress': 'All' } }).reply).toBe(false);
  });

  it('sin remitente válido no contesta', () => {
    expect(shouldReplyToEmail({ from: '' }).reply).toBe(false);
    expect(shouldReplyToEmail({ from: 'no-es-mail' }).reply).toBe(false);
  });

  it('NO contesta si el servidor marcó el remitente como falsificado', () => {
    const falsificado = 'mx.donweb.com; spf=fail smtp.mailfrom=agencia.com; dkim=fail';
    expect(shouldReplyToEmail({ ...ok, headers: { 'authentication-results': falsificado } })).toEqual({
      reply: false, reason: 'spf_dkim_fail',
    });
    expect(shouldReplyToEmail({ ...ok, headers: { 'authentication-results': 'mx; dmarc=fail' } }).reply).toBe(false);
  });

  it('SÍ contesta si SPF/DKIM pasan, o si el servidor no dejó veredicto', () => {
    expect(shouldReplyToEmail({ ...ok, headers: { 'authentication-results': 'mx; spf=pass; dkim=pass' } }).reply).toBe(true);
    expect(shouldReplyToEmail({ ...ok, headers: {} }).reply).toBe(true);           // sin header no es falla
    // Reenvíos legítimos rompen DKIM pero mantienen SPF: no se pueden rechazar.
    expect(shouldReplyToEmail({ ...ok, headers: { 'authentication-results': 'mx; spf=pass; dkim=fail' } }).reply).toBe(true);
  });

  it('no confunde a una agencia que se llama "news" con un newsletter', () => {
    expect(shouldReplyToEmail({ ...ok, from: 'juan@newsagency.com' }).reply).toBe(true);
  });
});

describe('authResult', () => {
  it('sin header no hay veredicto (no es falla)', () => {
    expect(authResult(undefined)).toBe('desconocido');
    expect(authResult('')).toBe('desconocido');
  });
  it('pass si cualquiera de los tres pasa', () => {
    expect(authResult('mx; spf=pass')).toBe('pass');
    expect(authResult('mx; dkim=pass header.d=x.com')).toBe('pass');
    expect(authResult('mx; dmarc=pass')).toBe('pass');
  });
  it('fail solo cuando de verdad falló', () => {
    expect(authResult('mx; spf=fail; dkim=fail')).toBe('fail');
    expect(authResult('mx; dmarc=fail')).toBe('fail');       // dmarc manda
    expect(authResult('mx; spf=pass; dmarc=fail')).toBe('fail');
  });
  it('spf=neutral / softfail no alcanzan para rechazar', () => {
    expect(authResult('mx; spf=neutral')).toBe('desconocido');
    expect(authResult('mx; spf=softfail')).toBe('desconocido');
  });
});
