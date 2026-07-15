import { describe, expect, it } from 'vitest';
import { imapConfigFromEnv } from './imap';

describe('imapConfigFromEnv', () => {
  const base = { IMAP_HOST: 'usuario.ferozo.com', IMAP_USER: 'hola@fepi.com', IMAP_PASSWORD: 'secreto' };

  it('sin casilla configurada devuelve null (el bot igual arranca)', () => {
    expect(imapConfigFromEnv({})).toBeNull();
    expect(imapConfigFromEnv({ IMAP_HOST: 'x' })).toBeNull();          // sin usuario
    expect(imapConfigFromEnv({ ...base, IMAP_PASSWORD: undefined })).toBeNull();
  });

  it('valores por defecto de DonWeb/Ferozo: 993 con SSL', () => {
    const c = imapConfigFromEnv(base)!;
    expect(c).toMatchObject({
      host: 'usuario.ferozo.com', port: 993, secure: true,
      mailbox: 'INBOX', failedMailbox: 'INBOX.Fallidos', pollSeconds: 60,
    });
  });

  it('la carpeta de fallidos se puede configurar', () => {
    expect(imapConfigFromEnv({ ...base, IMAP_FAILED_MAILBOX: 'INBOX.Errores' })!.failedMailbox).toBe('INBOX.Errores');
  });

  it('el puerto 143 apaga SSL solo', () => {
    expect(imapConfigFromEnv({ ...base, IMAP_PORT: '143' })!.secure).toBe(false);
  });

  it('IMAP_SECURE fuerza el SSL por encima del puerto', () => {
    expect(imapConfigFromEnv({ ...base, IMAP_PORT: '143', IMAP_SECURE: 'true' })!.secure).toBe(true);
    expect(imapConfigFromEnv({ ...base, IMAP_SECURE: 'false' })!.secure).toBe(false);
  });

  it('no deja pollear más rápido que cada 15s', () => {
    expect(imapConfigFromEnv({ ...base, IMAP_POLL_SECONDS: '1' })!.pollSeconds).toBe(15);
    expect(imapConfigFromEnv({ ...base, IMAP_POLL_SECONDS: '300' })!.pollSeconds).toBe(300);
  });
});
