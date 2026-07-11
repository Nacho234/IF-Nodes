import { describe, expect, it } from 'vitest';
import { checkSsrf, isBlockedHostname, isBlockedIp, ssrfPolicyFromEnv } from './ssrf';

describe('isBlockedIp', () => {
  it('bloquea loopback, privadas, link-local y metadata', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.5',
      '172.16.1.1',
      '172.31.255.255',
      '192.168.1.10',
      '169.254.169.254',
      '0.0.0.0',
      '100.64.0.1',
      '::1',
      'fe80::1',
      'fd12::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it('permite IPs públicas', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '172.15.0.1', '172.32.0.1', '2606:4700::1111']) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it('bloquea IPs malformadas por seguridad', () => {
    expect(isBlockedIp('999.1.1.1')).toBe(true);
  });
});

describe('isBlockedHostname', () => {
  it('bloquea localhost y dominios internos', () => {
    expect(isBlockedHostname('localhost')).toBe(true);
    expect(isBlockedHostname('LOCALHOST')).toBe(true);
    expect(isBlockedHostname('metadata.google.internal')).toBe(true);
    expect(isBlockedHostname('mi-servicio.internal')).toBe(true);
    expect(isBlockedHostname('impresora.local')).toBe(true);
    expect(isBlockedHostname('api.ejemplo.com')).toBe(false);
  });
});

describe('checkSsrf', () => {
  const blockPrivate = ssrfPolicyFromEnv({});

  it('modo block-private: bloquea resoluciones internas', () => {
    expect(checkSsrf('evil.com', ['1.2.3.4', '127.0.0.1'], blockPrivate)).toContain('interna');
    expect(checkSsrf('api.ejemplo.com', ['93.184.216.34'], blockPrivate)).toBeNull();
    expect(checkSsrf('localhost', ['1.2.3.4'], blockPrivate)).toContain('bloqueado');
  });

  it('modo allowlist: solo hosts declarados', () => {
    const policy = ssrfPolicyFromEnv({
      HTTP_NODE_POLICY: 'allowlist',
      HTTP_NODE_ALLOWED_HOSTS: 'api.ejemplo.com, otro.com',
    });
    expect(checkSsrf('api.ejemplo.com', ['93.184.216.34'], policy)).toBeNull();
    expect(checkSsrf('malicioso.com', ['93.184.216.34'], policy)).toContain('no está en la lista');
  });
});
