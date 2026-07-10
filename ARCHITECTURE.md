# IF Nodes — Arquitectura

## Vista general

```text
┌────────────────────── Builder interno (equipo) ──────────────────────┐
│                                                                       │
│  apps/web (Next.js 15)          apps/api (NestJS 11)                  │
│  ├─ Layout + navegación         ├─ auth (Google OAuth + sesiones DB)  │
│  ├─ Clientes / Proyectos        ├─ clients / projects / workflows     │
│  ├─ Constructor (React Flow)    ├─ executions (Fase 3+)               │
│  ├─ Simulador (Fase 5)          ├─ audit / health                     │
│  └─ Casos de prueba (Fase 6)    └─ SSE eventos (Fase 4)               │
│           │  /api/* rewrite              │            │               │
│           └──────────────────────────────┤            │               │
│                                     PostgreSQL      Redis             │
│                                          │            │               │
│                              apps/worker (Fase 3, BullMQ)             │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
                                   │ exporta (Fase 9)
                                   ▼
┌────────────────────── Runtime exportado (producción) ─────────────────┐
│  runtime genérico + workflow.json + manifest.json                     │
│  webhooks · health · logs · Dockerfile · railway.json                 │
│  SIN builder, SIN datos internos, SIN dependencias innecesarias       │
└───────────────────────────────────────────────────────────────────────┘
```

## Piezas y responsabilidades

### `apps/web` — Builder UI
- Next.js App Router, React 19, Tailwind v4, componentes estilo shadcn sobre Radix.
- React Flow (`@xyflow/react`) para el editor; Zustand para el estado del canvas; TanStack Query para estado remoto; React Hook Form + Zod en formularios.
- Habla con la API vía rewrite `/api/* → http://localhost:3001/*` (misma-origin ⇒ las cookies de sesión viajan sin CORS).
- El middleware de Next redirige a `/login` si no hay cookie de sesión; la validación real de la sesión ocurre siempre en la API.

### `apps/api` — Backend del builder
- NestJS 11. Módulos: `auth`, `clients`, `projects`, `workflows`, `audit`, `health` (Fase 1–2); `executions`, `events` (Fase 3–4); `credentials`, `environments`, `integrations` (Fase 7); `versions` (Fase 8); `exports` (Fase 9).
- Validación de entrada con **Zod** mediante `ZodValidationPipe` propio (un solo lugar de verdad para los esquemas: `packages/shared`).
- Sesiones: tabla `Session` en PostgreSQL; cookie `ifn_session` HttpOnly. Guards: `SessionGuard` (autenticación) y `RolesGuard` + `@RequireRole()` (autorización por matriz de permisos compartida).
- Logs estructurados JSON en producción, legibles en desarrollo.
- Seguridad HTTP: helmet, límites de payload, rate limiting (`@nestjs/throttler`), CORS restringido a `WEB_ORIGIN`.

### `apps/worker` (Fase 3)
- Proceso Node independiente. Consume la cola `executions` (BullMQ/Redis), carga la versión inmutable del flujo, ejecuta con `workflow-core`, persiste `ExecutionStep`/`ExecutionLog` y publica eventos por Redis pub/sub que la API re-emite por SSE.

### `packages/shared`
- `brand.ts`: nombre/identidad centralizados (el nombre "IF Nodes" es provisional y se cambia acá).
- `workflow-graph.ts`: **esquema Zod del grafo** (nodos, posiciones, config, aristas, notas, grupos). Es el contrato entre editor, API, motor y runtime.
- `permissions.ts`: roles y matriz de permisos usada por los guards.
- Tipos y constantes compartidas (estados de proyecto/cliente/ejecución).

### `packages/database`
- Prisma schema + cliente singleton + seed de desarrollo.
- Toda app que toque datos importa de acá; nadie instancia PrismaClient por su cuenta.

### `packages/node-definitions`
- Contrato `NodeDefinition<TConfig, TInput, TOutput>`: type, version, categoría, `configSchema` Zod, puertos, `execute()`, doc y compatibilidad de exportación.
- Registro central (`nodeRegistry`): agregar un nodo = agregar un archivo + registrarlo. Ver `NODE_DEVELOPMENT.md`.
- **Desacoplado del editor y del motor**: la UI solo consume metadatos (nombre, icono, categoría, puertos, schema para el formulario); el motor solo consume `execute`.

### `packages/workflow-core` (Fase 3)
- Motor puro sin IO: validación de grafo (trigger presente, conexiones, ciclos, nodos sueltos), orden de ejecución, contexto serializable, resolución de expresiones, ramas, reintentos/timeouts/esperas, errores estructurados (`WorkflowError`), cancelación y eventos. Ver `WORKFLOW_ENGINE.md`.

### `packages/expression-engine` (Fase 3)
- Parser propio de `{{ ... }}` sin `eval`: acceso por path al contexto + whitelist de funciones (`uppercase`, `formatDate`, `default`, …). Testeado de forma aislada.

### `packages/runtime-template` (Fase 9)
- Plantilla del proyecto exportado. Ver `EXPORT_RUNTIME.md`.

## Decisiones transversales

- **TypeScript estricto en todo** (`strict`, `noUncheckedIndexedAccess`). Sin `any` sin justificación en comentario.
- Paquetes compilan a CJS (`dist/`) para compatibilidad directa con NestJS; Next consume los mismos builds.
- El grafo viaja siempre completo y validado (`workflowGraphSchema.parse`) en cada guardado; la API rechaza grafos malformados.
- Nada de lógica de negocio en el frontend que el backend no vuelva a validar.

## Puertos y URLs (desarrollo)

| Servicio | URL |
|---|---|
| Web | http://localhost:3000 |
| API | http://localhost:3001 (proxied como `/api/*` desde la web) |
| PostgreSQL | localhost:5432 (`ifnodes` / docker compose) |
| Redis | localhost:6379 |
