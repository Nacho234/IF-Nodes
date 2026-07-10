# IF Nodes — Progreso

Estados: ✅ hecho y verificado · 🔶 hecho, verificación parcial (ver nota) · 🚧 en curso · ⬜ pendiente.

Última actualización: 2026-07-10 (cierre de Fase 1 + base de Fase 2).

## Fase 1 — Fundaciones

- ✅ Documentación inicial (PROJECT_PLAN, ARCHITECTURE, WORKFLOW_ENGINE, NODE_DEVELOPMENT, EXPORT_RUNTIME, SECURITY, PROGRESS, README)
- ✅ Monorepo npm workspaces + TypeScript estricto (`strict` + `noUncheckedIndexedAccess`)
- 🔶 Docker Compose (PostgreSQL 16 + Redis 7 con healthchecks) + `.env.example` — *compose escrito; no ejecutado en esta máquina porque no hay Docker instalado*
- 🔶 Prisma: schema completo (17 modelos, enums, índices) + seed idempotente — *`prisma generate` OK; migración y seed requieren la DB levantada*
- ✅ `packages/shared`: marca centralizada, matriz de roles/permisos, esquema Zod del grafo + validación estructural (trigger único, nodos sueltos, ciclos, aristas duplicadas)
- ✅ `packages/node-definitions`: contrato `NodeDefinition`, registro con versionado, 3 nodos demo (Inicio manual, Transformar datos, Respuesta)
- 🔶 API NestJS: auth Google OAuth + dev-login controlado + sesiones en DB (SHA-256, cookie HttpOnly, CSRF por header), guards de permisos, clientes, proyectos (crea flujo principal + 3 entornos), workflows (borrador validado + issues), catálogo de nodos, auditoría, health, helmet/CORS/rate-limit — *typecheck/lint/build/boot OK; endpoints con DB quedan verificados al levantar Docker*
- ✅ Web: login (métodos según API, dev-login señalizado), layout con sidebar colapsable, tema oscuro/claro, middleware de sesión
- 🔶 Web: Inicio con métricas reales, Clientes (tabla, filtros, alta, edición, archivar), Proyectos (tabla, filtros, alta, detalle con entornos y flujos) — *UI compilada y navegable; flujo completo con datos reales pendiente de DB*
- ✅ Secciones futuras (Plantillas, Ejecuciones, Credenciales, Integraciones, Exportaciones, Configuración) con estado honesto de fase — sin botones muertos

## Fase 2 — Constructor visual (base mínima entregada)

- ✅ Canvas React Flow: agregar (drag & drop y doble clic), mover, conectar, eliminar nodos/conexiones (Delete/Backspace), zoom, minimapa, fit view
- ✅ Biblioteca de nodos con buscador y categorías (se alimenta del catálogo de la API)
- ✅ Panel derecho: renombrar, formulario generado desde `uiHints` (text/textarea/code/switch/keyvalue), notas, activar/desactivar, duplicar, eliminar, puertos y variables disponibles
- ✅ Guardado: autosave con debounce (1,2 s) + Cmd/Ctrl+S, indicador guardando/guardado/sin guardar/error con reintento
- ✅ Validación: botón Validar + issues del backend (estructura y config por nodo) listados en la toolbar y marcados en el nodo
- ⬜ Pendiente para completar Fase 2: deshacer/rehacer, copiar/pegar, selección múltiple con acciones, grupos y notas en el lienzo, subflujos

## Módulos y archivos principales

| Módulo | Ubicación |
|---|---|
| Esquema del grafo + validación | `packages/shared/src/workflow-graph.ts` |
| Permisos | `packages/shared/src/permissions.ts` |
| Contrato y registro de nodos | `packages/node-definitions/src/{contract,registry}.ts` |
| Nodos demo | `packages/node-definitions/src/nodes/**` |
| Prisma schema / seed | `packages/database/prisma/schema.prisma`, `src/seed.ts` |
| Auth API | `apps/api/src/auth/*` |
| Clientes / Proyectos / Workflows | `apps/api/src/{clients,projects,workflows}/*` |
| Design tokens | `apps/web/app/globals.css` |
| Shell (sidebar, headers) | `apps/web/components/shell/*` |
| Builder | `apps/web/features/builder/*` |

## Pruebas realizadas (2026-07-10)

| Verificación | Resultado |
|---|---|
| `npm run typecheck` (5 workspaces) | ✅ sin errores |
| `npm run lint` (5 workspaces) | ✅ 0 errores, 0 warnings |
| `npm run test` — shared (10 tests: schema + validación estructural) | ✅ 10/10 |
| `npm run test` — node-definitions (10 tests: registro + executors de los 3 nodos) | ✅ 10/10 |
| `npm run build` — packages + API + web (13 rutas) | ✅ |
| Boot API (`node dist/main.js`): `/health/live`, `/auth/methods` | ✅ responde; `/health` reporta `database: down` honestamente (sin Docker) |
| Boot web (`next start`): redirect a `/login` sin sesión, `/login` 200, rewrite `/api/*` → NestJS | ✅ |
| Login end-to-end, CRUD con datos, migración y seed | ⏸ requieren `docker compose up` (sin Docker en esta máquina) |

## Problemas encontrados

- **Sin Docker/Postgres/Redis en la máquina de desarrollo** → imposible verificar migraciones, seed y flujo con datos en esta sesión. Mitigación: compose listo con healthchecks, instrucciones en README, todo lo demás verificado.
- **Puerto 3000 ocupado** por otro proceso local del equipo → el smoke test de la web se hizo en el puerto 3010; en uso normal, liberar el 3000 o pasar `--port`.
- Tipos: `zodResolver` no acepta schemas con `.default()` (input≠output) → se quitó el default de `status` (el form siempre lo envía). `ZodType<TConfig>` del contrato de nodos pasó a `ZodType<TConfig, ZodTypeDef, unknown>`.
- ESLint `consistent-type-imports` desactivada solo en la API: convertir servicios inyectados a `import type` rompe la DI de Nest (documentado en `apps/api/eslint.config.mjs`).

## Decisiones pendientes

- Crear credenciales OAuth en Google Cloud y cargar `AUTHORIZED_EMAILS` del equipo.
- Instalar Docker Desktop y correr la verificación E2E de Fase 1 (migrar, seed, login dev, CRUD, guardar flujo).
- Nombrar la primera migración de Prisma (`npm run db:migrate`).

## Próxima fase

**Completar Fase 2** (undo/redo, copiar/pegar, multi-selección, notas y grupos) y arrancar **Fase 3** (motor local: `workflow-core` puro + worker BullMQ + ejecuciones con historial de pasos), según PROJECT_PLAN.md.
