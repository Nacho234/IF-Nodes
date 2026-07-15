import { describe, expect, it } from 'vitest';
import { parseInboundEmail, parseAddress, stripQuotedReply, htmlToText } from './parse-inbound';

describe('parseAddress', () => {
  it('separa nombre y dirección', () => {
    expect(parseAddress('Juan Pérez <Juan@Agencia.com>')).toEqual({ name: 'Juan Pérez', address: 'juan@agencia.com' });
  });
  it('acepta una dirección pelada', () => {
    expect(parseAddress('  Hola@Agencia.COM ')).toEqual({ name: '', address: 'hola@agencia.com' });
  });
  it('saca las comillas del nombre', () => {
    expect(parseAddress('"Agencia, S.L." <info@ag.es>').name).toBe('Agencia, S.L.');
  });
});

describe('stripQuotedReply', () => {
  it('corta en "El ... escribió:" (Gmail en español)', () => {
    const body = 'Dale, me interesa.\n\nEl mar, 15 jul 2026 a las 10:03, FePI escribió:\n> Hola, te cuento del festival';
    expect(stripQuotedReply(body)).toBe('Dale, me interesa.');
  });
  it('corta en "On ... wrote:" (Gmail en inglés)', () => {
    expect(stripQuotedReply('Sure thing.\n\nOn Tue, Jul 15, 2026 at 10:03 FePI wrote:\n> hi')).toBe('Sure thing.');
  });
  it('corta en la cita con >', () => {
    expect(stripQuotedReply('Perfecto\n> anterior')).toBe('Perfecto');
  });
  it('corta en -----Original Message-----', () => {
    expect(stripQuotedReply('Ok\n\n-----Original Message-----\nviejo')).toBe('Ok');
  });
  it('corta en la firma "-- "', () => {
    expect(stripQuotedReply('Gracias!\n-- \nJuan\nDirector')).toBe('Gracias!');
  });
  it('no toca un mail sin cita', () => {
    expect(stripQuotedReply('Hola, quería consultar por las categorías.')).toBe('Hola, quería consultar por las categorías.');
  });
});

describe('htmlToText', () => {
  it('convierte párrafos y saltos, y decodifica entidades', () => {
    expect(htmlToText('<p>Hola&nbsp;&amp; chau</p><br><div>Segunda</div>')).toBe('Hola & chau\n\nSegunda');
  });
  it('descarta style y script', () => {
    expect(htmlToText('<style>p{color:red}</style><p>Texto</p>')).toBe('Texto');
  });
});

describe('parseInboundEmail', () => {
  it('forma normalizada (relay de Gmail)', () => {
    const m = parseInboundEmail({
      from: 'Ana <ana@agencia.com>', subject: 'Re: FePI', text: 'Me interesa\n\nOn Tue wrote:\n> viejo',
      messageId: '<abc@mail>', inReplyTo: '<prev@mail>',
    })!;
    expect(m.from).toBe('ana@agencia.com');
    expect(m.name).toBe('Ana');
    expect(m.text).toBe('Me interesa');
    expect(m.channel).toBe('email');
    expect(m.messageId).toBe('<abc@mail>');
  });

  it('Postmark', () => {
    const m = parseInboundEmail({
      From: 'ana@agencia.com', FromFull: { Email: 'ana@agencia.com', Name: 'Ana Ruiz' },
      Subject: 'Consulta', TextBody: 'Hola', MessageID: 'pm-1',
    })!;
    expect(m.name).toBe('Ana Ruiz');
    expect(m.text).toBe('Hola');
    expect(m.messageId).toBe('pm-1');
  });

  it('Mailgun: usa stripped-text tal cual (ya viene sin la cita)', () => {
    const m = parseInboundEmail({
      sender: 'ana@agencia.com', subject: 'Re', 'stripped-text': 'Sí, dale', 'body-plain': 'Sí, dale\n> viejo',
    })!;
    expect(m.text).toBe('Sí, dale');
  });

  it('cae al HTML cuando no hay parte de texto', () => {
    const m = parseInboundEmail({ from: 'a@b.com', html: '<p>Desde HTML</p>' })!;
    expect(m.text).toBe('Desde HTML');
  });

  it('sin remitente devuelve null: no hay hilo posible', () => {
    expect(parseInboundEmail({ subject: 'huérfano', text: 'hola' })).toBeNull();
    expect(parseInboundEmail({ from: 'no-es-un-mail', text: 'hola' })).toBeNull();
    expect(parseInboundEmail(null)).toBeNull();
  });

  it('el nombre cae al usuario de la dirección si no viene', () => {
    expect(parseInboundEmail({ from: 'produccion@agencia.com', text: 'x' })!.name).toBe('produccion');
  });
});
