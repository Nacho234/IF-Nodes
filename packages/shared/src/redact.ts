const SENSITIVE_KEY = /token|secret|password|passwd|api[-_]?key|authorization|credential|bearer/i;
const MAX_DEPTH = 8;

export const REDACTED = '[REDACTADO]';

/**
 * Redacción de secretos antes de persistir o loguear inputs/outputs/configs.
 * Enmascara valores cuyas claves suenan sensibles, recursivamente.
 */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[PROFUNDIDAD_MAXIMA]';
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactSecrets(item, depth + 1);
    }
    return out;
  }
  return value;
}
