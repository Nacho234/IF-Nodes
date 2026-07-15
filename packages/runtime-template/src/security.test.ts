import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { checkApiKey, checkWhatsAppSignature, checkEmailWebhookToken, safeEqual, RateLimiter } from './security';

describe('safeEqual', () => {
  it('compara sin filtrar por longitud parcial', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('checkApiKey', () => {
  const env = { RUNTIME_API_KEY: 'clave-secreta' } as NodeJS.ProcessEnv;

  it('acepta Bearer y x-api-key', () => {
    expect(checkApiKey({ authorization: 'Bearer clave-secreta' }, env)).toBeNull();
    expect(checkApiKey({ 'x-api-key': 'clave-secreta' }, env)).toBeNull();
  });
  it('rechaza si falta o no coincide', () => {
    expect(checkApiKey({}, env)).toBe('falta_api_key');
    expect(checkApiKey({ authorization: 'Bearer otra' }, env)).toBe('api_key_invalida');
  });
  it('sin key configurada no puede exigir nada (el arranque lo advierte)', () => {
    expect(checkApiKey({}, {} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe('checkWhatsAppSignature', () => {
  const env = { WHATSAPP_APP_SECRET: 'app-secret' } as NodeJS.ProcessEnv;
  const body = Buffer.from('{"entry":[]}');
  const firma = 'sha256=' + createHmac('sha256', 'app-secret').update(body).digest('hex');

  it('acepta la firma correcta de Meta', () => {
    expect(checkWhatsAppSignature(firma, body, env)).toBeNull();
  });
  it('rechaza firma ausente, mal formada o de otro cuerpo', () => {
    expect(checkWhatsAppSignature(undefined, body, env)).toBe('firma_ausente');
    expect(checkWhatsAppSignature('sha1=abc', body, env)).toBe('firma_ausente');
    expect(checkWhatsAppSignature(firma, Buffer.from('{"entry":[1]}'), env)).toBe('firma_invalida');
  });
});

describe('checkEmailWebhookToken', () => {
  const env = { EMAIL_WEBHOOK_TOKEN: 'tok' } as NodeJS.ProcessEnv;
  it('exige el token en la URL', () => {
    expect(checkEmailWebhookToken(new URL('http://x/webhooks/email?token=tok'), env)).toBeNull();
    expect(checkEmailWebhookToken(new URL('http://x/webhooks/email'), env)).toBe('token_invalido');
    expect(checkEmailWebhookToken(new URL('http://x/webhooks/email?token=mal'), env)).toBe('token_invalido');
  });
});

describe('RateLimiter', () => {
  it('corta al pasarse del máximo dentro de la ventana', () => {
    const rl = new RateLimiter(3, 60_000);
    expect(rl.limited('1.1.1.1')).toBe(false);
    expect(rl.limited('1.1.1.1')).toBe(false);
    expect(rl.limited('1.1.1.1')).toBe(false);
    expect(rl.limited('1.1.1.1')).toBe(true);
    expect(rl.limited('2.2.2.2')).toBe(false); // otra IP no se ve afectada
  });
});
