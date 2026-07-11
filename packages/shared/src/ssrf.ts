/**
 * Chequeos SSRF puros (sin red): decidir si una IP o host está bloqueado.
 * El worker resuelve DNS y consulta acá antes de conectar (ver SECURITY.md).
 */

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);

export function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return BLOCKED_HOSTNAMES.has(lower) || lower.endsWith('.internal') || lower.endsWith('.local');
}

/** true si la IP (v4 o v6) es loopback, privada, link-local o metadata cloud. */
export function isBlockedIp(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

  if (v4.includes('.')) {
    const parts = v4.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts as [number, number, number, number];
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10/8
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    return false;
  }

  // IPv6
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true; // unspecified / loopback
  if (lower.startsWith('fe80')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local
  return false;
}

export interface SsrfPolicy {
  /** 'block-private' (default) o 'allowlist' */
  mode: 'block-private' | 'allowlist';
  allowedHosts: string[];
}

export function ssrfPolicyFromEnv(env: { HTTP_NODE_POLICY?: string; HTTP_NODE_ALLOWED_HOSTS?: string }): SsrfPolicy {
  return {
    mode: env.HTTP_NODE_POLICY === 'allowlist' ? 'allowlist' : 'block-private',
    allowedHosts: (env.HTTP_NODE_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  };
}

/** Valida host + IPs resueltas contra la política. Devuelve el motivo del bloqueo o null. */
export function checkSsrf(hostname: string, resolvedIps: string[], policy: SsrfPolicy): string | null {
  const host = hostname.toLowerCase();
  if (policy.mode === 'allowlist') {
    if (!policy.allowedHosts.includes(host)) {
      return `El host ${host} no está en la lista de permitidos (HTTP_NODE_ALLOWED_HOSTS).`;
    }
    return null;
  }
  if (isBlockedHostname(host)) return `El host ${host} está bloqueado por política SSRF.`;
  for (const ip of resolvedIps) {
    if (isBlockedIp(ip)) return `El host ${host} resuelve a una IP interna/privada (${ip}) — bloqueado.`;
  }
  return null;
}
