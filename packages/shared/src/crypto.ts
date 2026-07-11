/**
 * Cifrado de secretos (credenciales y variables de entorno) — AES-256-GCM.
 * ⚠️ Solo para API y worker: NO se re-exporta desde el index del paquete
 * para que nunca entre en el bundle del navegador.
 * Importar como: import { encryptSecret } from '@ifnodes/shared/dist/crypto';
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

function keyFromEnv(): Buffer {
  const hex = process.env.CREDENTIALS_ENCRYPTION_KEY ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY inválida: se esperan 64 caracteres hex (generar con `openssl rand -hex 32`).',
    );
  }
  return Buffer.from(hex, 'hex');
}

/** Devuelve "iv:tag:cipher" en hex. */
export function encryptSecret(plaintext: string): string {
  const key = keyFromEnv();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(payload: string): string {
  const key = keyFromEnv();
  const [ivHex, tagHex, dataHex] = payload.split(':');
  if (!ivHex || !tagHex || !dataHex) throw new Error('Secreto cifrado con formato inválido.');
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}
