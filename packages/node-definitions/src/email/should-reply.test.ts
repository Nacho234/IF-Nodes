import { describe, expect, it } from 'vitest';
import { shouldReplyToEmail } from './should-reply';

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

  it('no confunde a una agencia que se llama "news" con un newsletter', () => {
    expect(shouldReplyToEmail({ ...ok, from: 'juan@newsagency.com' }).reply).toBe(true);
  });
});
