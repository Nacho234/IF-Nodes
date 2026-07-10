# IF Nodes — Seguridad

Política de seguridad del builder y del runtime exportado. Los ítems marcados con su fase se implementan en esa fase; el resto está activo desde Fase 1.

## Autenticación y sesiones (Fase 1 — activo)

- Google OAuth con verificación de `id_token` (`google-auth-library`); **lista de emails autorizados** (`AUTHORIZED_EMAILS`): un OAuth válido con email fuera de la lista se rechaza y se audita.
- Sesiones opacas en PostgreSQL (token aleatorio de 256 bits, hasheado SHA-256 en DB), cookie `ifn_session` `HttpOnly` + `SameSite=Lax` (+ `Secure` y `__Host-` en producción). Expiración deslizante 7 días.
- Sin JWT en `localStorage`. Logout revoca la sesión en DB.
- Mutaciones: la API exige el header `x-ifn-csrf: 1` en métodos no-GET (los navegadores no permiten headers custom cross-site sin CORS preflight, que está restringido a `WEB_ORIGIN`), además de `SameSite=Lax`.
- **Dev-login**: `POST /auth/dev-login` existe solo si `AUTH_DEV_LOGIN=true` **y** `NODE_ENV !== 'production'`. Respeta la lista de autorizados, queda auditado y la UI lo marca como modo desarrollo. Motivo documentado en `PROJECT_PLAN.md` §6.

## Autorización (Fase 1 — activo)

- Roles globales `OWNER > DEVELOPER > TESTER > VIEWER`, matriz en `packages/shared/src/permissions.ts`.
- Validación **en backend** con guards de NestJS; la UI solo oculta acciones, nunca es la única barrera.

## HTTP hardening del API (Fase 1 — activo)

- `helmet`, CORS restringido a `WEB_ORIGIN` con `credentials`, límite de payload JSON 1 MB (los grafos grandes siguen muy por debajo), rate limiting global (`@nestjs/throttler`) más estricto en `/auth/*`.
- Validación Zod de todo input; errores de validación no filtran internals.
- Logs estructurados sin secretos: redactor central (`redactSecrets`) aplicado a config/inputs/outputs antes de persistir o loguear (activo desde Fase 3 para steps; desde Fase 1 para logs HTTP).

## Credenciales y variables de entorno (Fase 7)

- Cifrado **AES-256-GCM** con clave maestra `CREDENTIALS_ENCRYPTION_KEY` (32 bytes hex, generada con `openssl rand -hex 32`, solo en env, jamás en repo).
- El frontend nunca recibe el secreto después de guardado: solo metadata + últimos 4 caracteres enmascarados.
- Variables de entorno de proyecto marcadas `secret` se cifran igual; en el editor se muestran enmascaradas.
- Rotación y desactivación auditadas.

## Nodo HTTP / SSRF (Fase 7)

- Política por defecto `block-private`: se resuelve DNS **antes** de conectar y se bloquea si alguna IP resultante es loopback (`127/8`, `::1`), privada (`10/8`, `172.16/12`, `192.168/16`), link-local/metadata (`169.254/16`, incluida `169.254.169.254`), o `0.0.0.0/8`; también `localhost` y dominios `.internal`. Redirecciones re-validadas salto a salto (máx. 5).
- Modo `allowlist` opcional (`HTTP_NODE_ALLOWED_HOSTS`).
- Timeouts y tamaño máximo de respuesta acotados.

## Webhooks (Fases 3–7 y runtime)

- Tokens públicos aleatorios no adivinables por endpoint.
- WhatsApp Cloud: verificación `hub.verify_token` + validación de firma `X-Hub-Signature-256`; deduplicación por message id (idempotencia).
- Límites de payload y rate limiting también en el runtime exportado.

## Motor (Fase 3)

- Sin `eval` ni ejecución de JavaScript arbitrario del usuario. El futuro nodo "código interno" será un DSL restringido, no JS.
- Límites duros: máximo de pasos por ejecución, duración total máxima, reintentos máximos.
- Esperas sin procesos bloqueados (delayed jobs).

## Exportación (Fase 9)

- `workflow.json` sin secretos; chequeo automático anti-fuga antes de empaquetar (schema + scan de patrones).
- Sin datos internos del equipo en el paquete (casos de prueba, ejecuciones, notas, credenciales de desarrollo).
- Nombres de archivos sanitizados (slug), sin path traversal.
- `.env.example` generado con todas las variables requeridas y sin valores.

## Auditoría (Fase 1 base, se amplía por fase)

Se registran: login (incluye dev-login), login rechazado por lista, creación/edición/archivado de clientes y proyectos, guardado de flujo; luego: versiones, credenciales, ejecuciones manuales, exportaciones, cambios de permisos, eliminaciones. Cada entrada: usuario, acción, entidad, id, fecha, IP y user-agent si están disponibles. **Nunca secretos ni payloads sensibles.**

## Reporte de problemas

Herramienta interna: reportar en el canal del equipo. No abrir issues públicos con detalles sensibles.
