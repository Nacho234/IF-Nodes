# IF Nodes — Plan de proyecto

Herramienta **interna** para el equipo de desarrollo: crear, probar, depurar y exportar bots y automatizaciones con un constructor visual de nodos. No es un SaaS público. El entregable final de cada proyecto es un **runtime exportado independiente** que se despliega en Railway/VPS.

```text
Crear proyecto → Diseñar flujo → Configurar integraciones → Simular entradas
→ Ejecutar y depurar → Corregir → Versión estable → Exportar → GitHub → Deploy
```

## 1. Análisis del repositorio inicial

El repositorio estaba **vacío** (proyecto nuevo). No hay código previo que preservar.

Entorno de desarrollo detectado en la máquina:

| Herramienta | Estado |
|---|---|
| Node.js v26 / npm 11 | ✅ |
| pnpm | ❌ no instalado |
| Docker / Colima / Podman | ❌ no instalados |
| PostgreSQL / Redis locales | ❌ no instalados |

**Implicancia:** se entrega `docker/docker-compose.yml` (Postgres 16 + Redis 7) listo para usar, pero en esta máquina no se puede verificar el arranque de la base de datos hasta instalar Docker Desktop. La verificación local de cada fase cubre: TypeScript estricto, ESLint, tests unitarios (Vitest) y builds de web/api. Está documentado en `PROGRESS.md`.

## 2. Principio de arquitectura: Builder vs. Runtime

Dos componentes completamente separados:

- **Builder interno** (`apps/web` + `apps/api` + worker futuro): gestión de clientes/proyectos, constructor visual, simulador, casos de prueba, ejecuciones, credenciales, versionado, exportación.
- **Runtime exportable** (`packages/runtime-template`, Fase 9): proyecto independiente y liviano que interpreta `workflow.json` con un motor genérico. Sin editor, sin dashboard, sin datos del equipo. Ver `EXPORT_RUNTIME.md`.

La pieza que comparten es el **motor** (`packages/workflow-core`) y las **definiciones de nodos** (`packages/node-definitions`): el mismo código ejecuta el flujo en el builder (con debugging) y en producción (liviano). Así lo que se prueba es exactamente lo que se despliega.

## 3. Estructura del monorepo

```text
apps/
  web/        Next.js 15 App Router — UI del builder
  api/        NestJS 11 — auth, clientes, proyectos, flujos, ejecuciones
  worker/     (Fase 3) consumidor BullMQ que ejecuta flujos

packages/
  shared/            Tipos, esquemas Zod del grafo, roles/permisos, marca
  database/          Prisma schema + cliente + seed
  node-definitions/  Contrato NodeDefinition + registro de nodos
  workflow-core/     (Fase 3) motor puro de ejecución
  expression-engine/ (Fase 3) parser seguro de {{expresiones}} sin eval
  runtime-template/  (Fase 9) plantilla del proyecto exportado
docker/   docker-compose (Postgres + Redis)
docs/     (índice de documentación en /: ARCHITECTURE, WORKFLOW_ENGINE, etc.)
```

## 4. Alcance del MVP

El MVP se considera cumplido cuando funciona el recorrido de 27 pasos del brief (login → crear cliente/proyecto/flujo → construir → ejecutar → depurar → caso de prueba → versión estable → exportar → runtime corriendo en Docker). Se construye por fases; **este repositorio avanza fase por fase y no se inicia una fase con la anterior rota**.

### Fuera del MVP (explícitamente)

- Portal para clientes, facturación, marketplace.
- Despliegue automático vía API de Railway (queda la interfaz `DeploymentProvider` preparada; el deploy inicial es manual post-export).
- Ejecución de JavaScript arbitrario en nodos (el nodo "código interno" será un DSL limitado y seguro).
- Copiar la totalidad de n8n: solo el set de nodos definido en el brief.

## 5. Modelo de datos (builder)

Modelos en `packages/database/prisma/schema.prisma`:

`User, Session, Client, Project, Workflow, WorkflowVersion, Execution, ExecutionStep, ExecutionLog, TestCase, Environment, EnvironmentVariable, Credential, Integration, Export, AuditLog`

Decisiones de normalización (adaptaciones respecto de la lista mínima del brief, con justificación):

| Brief | Implementación | Justificación |
|---|---|---|
| `WorkflowDraft`, `WorkflowNode`, `WorkflowEdge` | JSON `Workflow.draftGraph` + snapshot inmutable `WorkflowVersion.graph`, ambos validados con Zod (`workflowGraphSchema`) | El editor siempre lee/escribe el grafo completo; tablas por nodo/arista generan N+1 y migraciones constantes sin aportar consultas necesarias. La validación fuerte queda en el esquema Zod compartido. |
| `TestAssertion` | JSON tipado dentro de `TestCase.assertions` | Las assertions se evalúan siempre junto al caso; no se consultan por separado. |
| `SubflowReference` | Campo `subflowIds` derivado del grafo al versionar (Fase 8) | Se calcula del grafo; evita duplicación de fuente de verdad. |
| `NodeType` | Registro en código (`packages/node-definitions`) | Los tipos de nodo son código versionado (schema + executor), no datos. La DB guarda `type` + `nodeVersion` por nodo del grafo. |
| `ProjectMember` | Diferido | Equipo interno chico: todos los usuarios autorizados ven todos los proyectos; roles globales (Owner/Developer/Tester/Viewer) validados en backend. Se agrega si aparece la necesidad real. |

Índices: por cliente, proyecto, estado, fechas, workflow, versión y ejecución (ver schema).

## 6. Autenticación

- Google OAuth (flujo authorization-code manejado por la API, verificación de `id_token` con `google-auth-library`).
- **Lista de emails autorizados** (`AUTHORIZED_EMAILS` en env): cualquier email fuera de la lista es rechazado aunque el OAuth sea válido.
- Sesiones persistidas en PostgreSQL, cookie `HttpOnly` + `SameSite=Lax` (+ `Secure` en producción). Sin tokens en `localStorage`.
- Roles globales: `OWNER`, `DEVELOPER`, `TESTER`, `VIEWER` — matriz en `packages/shared/src/permissions.ts`, aplicada por guards en backend.
- **Modo de desarrollo controlado:** como el OAuth requiere credenciales de Google Cloud que no existen aún en este entorno, hay un endpoint `POST /auth/dev-login` que **solo** se habilita con `AUTH_DEV_LOGIN=true` y `NODE_ENV !== 'production'`, respeta la lista de autorizados y queda señalizado en la UI como "Ingreso de desarrollo". No es un mock silencioso: está documentado acá, en `SECURITY.md` y visible en la pantalla de login.

## 7. Fases

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Monorepo, infraestructura, Prisma, auth, usuarios, clientes, proyectos, layout | ✅ verificada E2E |
| 2 | Constructor React Flow (crear/conectar/guardar/validar/undo/copy/notas) | ✅ (pendiente: grupos y subflujos) |
| 3 | Motor: expression-engine, workflow-core, worker BullMQ, ejecuciones | ✅ núcleo verificado E2E (pendiente: nodo Esperar) |
| 4 | Debugging: inspector, logs, reintento, tiempo real | 🔶 (polling en vivo; falta SSE, ejecutar desde nodo, comparar) |
| 5 | Simulador (WhatsApp, webhook, escenarios) | ⬜ |
| 6 | Casos de prueba + assertions | ⬜ |
| 7 | Integraciones: HTTP, IA, SMTP, WhatsApp Cloud, credenciales, entornos | ⬜ |
| 8 | Versionado inmutable, comparación, estable | ⬜ |
| 9 | Exportador + runtime genérico + Docker/Railway | ⬜ |
| 10 | Calidad: seguridad, testing E2E, a11y, docs | ⬜ |

## 8. Riesgos técnicos

| Riesgo | Mitigación |
|---|---|
| Sin Docker en la máquina de desarrollo → DB/Redis no verificables hoy | compose con healthchecks listo; instrucciones en README; el resto de la verificación no depende de infraestructura |
| Divergencia builder/runtime | mismo `workflow-core` + `node-definitions` en ambos; el runtime solo interpreta el mismo JSON |
| Expresiones de usuario | parser propio sin `eval`, whitelist de funciones, testeado (Fase 3) |
| Secretos filtrados a logs/exports | cifrado AES-256-GCM, redactor central, `workflow.json` nunca contiene secretos (ver `SECURITY.md`) |
| SSRF en nodo HTTP | resolución DNS + bloqueo de IPs privadas/loopback/metadata (Fase 7, política en `SECURITY.md`) |
| Ciclos/flujo desbocado | validación de grafo + límite de pasos y duración por ejecución |
| OAuth sin credenciales en dev | dev-login controlado y explícito (ver §6) |

## 9. Decisiones técnicas (registro vivo)

1. **npm workspaces** en lugar de Turborepo/pnpm: pnpm no está instalado y el pipeline actual (build de 3 apps + 3 packages) no justifica todavía la caché de Turbo. Migrable sin cambiar estructura.
2. **Grafo como JSON validado por Zod** (ver §5).
3. **Sesiones en PostgreSQL**, no Redis: Redis queda para colas/eventos (Fase 3); si Redis cae, el login sigue.
4. **Tailwind CSS v4** (config CSS-first) + componentes estilo shadcn escritos en el repo sobre Radix: control total de theming (dark primero) sin depender del CLI. `packages/ui` se difiere: hoy solo `apps/web` consume UI; extraer paquete sin segundo consumidor es sobrearquitectura (documentado).
5. **Dev-login controlado** (ver §6).
6. **Worker diferido a Fase 3**: en Fase 1–2 no hay ejecuciones; crear el proceso vacío hoy solo agrega ruido. El compose ya reserva Redis.
7. **Diseño**: estética de herramienta técnica (referencias: IDEs, Postman, observabilidad). Tokens en `apps/web/app/globals.css`; tipografía Geist Sans + Geist Mono; acento azul `#2F81F7`-familia; dark mode de primera clase; densidad de información alta con jerarquía clara; sin tarjetas genéricas.
8. **Progreso en vivo por polling (700 ms) en lugar de SSE** para la primera versión de "ver los nodos iluminarse": funciona con cualquier infraestructura y sin conexiones persistentes; SSE lo reemplaza al completar la Fase 4 (el motor ya publica los pasos vía hooks).
9. **Infra local por Homebrew como fallback de Docker**: la máquina de desarrollo no tiene Docker, así que PostgreSQL 16 y Redis 7 corren con `brew services`. `docker/docker-compose.yml` sigue siendo la forma canónica en máquinas con Docker; la app solo ve `DATABASE_URL`/`REDIS_URL`.
10. **`{{trigger.*}}` expone la salida del nodo disparador** (no el payload crudo): el trigger normaliza la entrada (p.ej. el manual aplica su payload de ejemplo si no recibe datos) y el resto del flujo consume esa forma. Detectado y corregido en la verificación E2E.
