# IF Nodes — Progreso

Estados: ✅ hecho y verificado · 🔶 hecho, verificación parcial (ver nota) · 🚧 en curso · ⬜ pendiente.

Última actualización: 2026-07-11 (cuarta tanda: **Fase 6 — casos de prueba** con assertions, verificado E2E).

## Fase 1 — Fundaciones ✅

- ✅ Documentación (PROJECT_PLAN, ARCHITECTURE, WORKFLOW_ENGINE, NODE_DEVELOPMENT, EXPORT_RUNTIME, SECURITY, README)
- ✅ Monorepo npm workspaces + TypeScript estricto
- ✅ Infraestructura local: PostgreSQL 16 + Redis 7 **corriendo** (brew services; `docker/docker-compose.yml` sigue siendo la opción canónica para otras máquinas)
- ✅ Prisma: schema (17 modelos) + migración `init` aplicada + seed corrido (owner + cliente/proyecto/flujo demo)
- ✅ `packages/shared`: marca, permisos, grafo Zod + validación estructural, redactor de secretos, contratos de cola
- ✅ API NestJS: auth (dev-login verificado E2E; Google OAuth listo a falta de credenciales), sesiones DB, guards, clientes, proyectos, workflows, catálogo de nodos, auditoría, health
- ✅ Web: login, layout (sidebar colapsable, dark/light), Inicio, Clientes, Proyectos — navegable con datos reales

## Fase 2 — Constructor visual ✅

- ✅ Canvas React Flow: drag & drop, mover, conectar, eliminar, zoom, minimapa, fit view
- ✅ Biblioteca de nodos con buscador y categorías
- ✅ Panel derecho: renombrar, formulario desde `uiHints`, notas, activar/desactivar, duplicar, eliminar, puertos, variables, **entrada/salida de la última ejecución**
- ✅ Guardado: autosave con debounce + ⌘S + indicador de estado
- ✅ Validación con issues de estructura y de config por nodo
- ✅ Deshacer/rehacer (⌘Z / ⇧⌘Z, historial 50 entradas: estructura y movimientos)
- ✅ Copiar/pegar (⌘C/⌘V con offset) y duplicar (⌘D); selección múltiple nativa (shift)
- ✅ Notas adhesivas en el lienzo (persisten en `stickyNotes`)
- ⬜ Grupos de nodos y subflujos → cuando existan múltiples flujos por proyecto (Fase 3+)

## Fase 3 — Motor ✅ (núcleo)

- ✅ `packages/expression-engine`: parser propio sin `eval` (paths seguros anti-prototype-pollution, whitelist de 13 funciones, plantillas e interpolación) — 15 tests
- ✅ `packages/workflow-core`: motor puro (validación, ramas por puertos, contexto serializable, resolución de expresiones, 5 estrategias de error, reintentos con backoff, timeout por nodo y global acotado, cancelación por señal, límite de pasos, hooks por paso) — 19 tests
- ✅ `apps/worker`: consumidor BullMQ, persiste Execution/ExecutionStep/ExecutionLog con secretos redactados; idempotencia por jobId; logs JSON estructurados
- ✅ API `executions`: ejecutar borrador (valida antes de encolar), listar con filtros, detalle con pasos y logs, **reintentar**; 503 claro si Redis no está
- ⬜ Nodo Esperar (delayed jobs) y ejecución desde un nodo → siguiente iteración

## Fase 5 — Simulador ✅ (WhatsApp v1)

- ✅ Panel de simulador en el constructor (botón en toolbar): chat cliente↔bot, nombre y teléfono configurables, reiniciar conversación, indicador "escribiendo", link a la ejecución de cada respuesta
- ✅ Cada mensaje ejecuta el flujo real vía cola+worker y el recorrido se ilumina en el lienzo
- ✅ Mismo formato interno que usará el proveedor real de WhatsApp (Fase 7): los nodos no distinguen simulado de real
- ✅ Aviso honesto si el flujo no tiene trigger de WhatsApp activo
- ⬜ Simular imagen/audio/ubicación/botones; memoria de conversación entre mensajes (requiere entidades de Conversación)

## Nodos y webhooks (tercera tanda)

- ✅ Nodos nuevos: `trigger.webhook`, `trigger.whatsapp-message`, `logic.condition` (8 operadores), `logic.switch` (3 casos + default), `logic.set-variable` (motor extendido con `result.variables`)
- ✅ Endpoint público `POST /hooks/:token` (token único no adivinable por flujo, migración con backfill, rate limit propio, 404 genérico, redacción de payload)
- ✅ URL del webhook visible con botón copiar al seleccionar el nodo en el builder
- ✅ Widget `select` en el panel de configuración (faltaba)
- ✅ Flujo demo del seed actualizado al del brief: WhatsApp → variable → ¿pide turno? → rama turnos / rama general (con nota adhesiva)

## Fase 6 — Casos de prueba ✅ (núcleo)

- ✅ Assertions tipadas (schema Zod + evaluador puro en `shared`, 9 tests): igual a, contiene, existe, no existe, tipo, mayor/menor, nodo visitado/no visitado, estado final — con paths sobre `output.*`, `nodes.<id>.output.*`, `variables.*`, `trigger.*` (anti prototype-pollution)
- ✅ API: CRUD de casos + duplicar + `run` (ejecución `source=TEST_CASE`) + `evaluate` (persiste PASSED/FAILED con detalle por assertion)
- ✅ UI: página Casos de prueba por proyecto (ejecutar uno / **ejecutar todos** en secuencia, resultado por assertion con mensaje de diff, link a la ejecución, editar/duplicar/eliminar)
- ✅ Builder: botón "Guardar caso" tras una ejecución (prellenado con la entrada real)
- ✅ Página del proyecto: accesos reales a Casos de prueba y Ejecuciones (dejaron de ser "planificadas")
- ⬜ Guardar ejecución del simulador como caso con un clic; assertions sugeridas automáticamente

## Fase 4 — Debugging (parcial)

- ✅ Botón **Ejecutar** en el constructor: nodos se iluminan en vivo (polling 700 ms), estado con icono+texto y duración por nodo
- ✅ Página global Ejecuciones (filtros por estado, auto-refresh si hay activas)
- ✅ Detalle de ejecución: recorrido por nodo con entrada/salida/error/intentos/duración, disparador, salida final, logs, reintentar, link al constructor
- ⬜ SSE en tiempo real (hoy: polling — decisión en PROJECT_PLAN §9.9), comparar ejecuciones, descargar diagnóstico

## Verificaciones (2026-07-10, tercera tanda)

| Verificación | Resultado |
|---|---|
| `npm run typecheck` (7 workspaces) | ✅ |
| `npm run lint` (7 workspaces) | ✅ 0 errores, 0 warnings |
| Tests unitarios: shared 19 · node-definitions 22 · expression-engine 15 · workflow-core 20 | ✅ **76/76** |
| E2E casos de prueba: caso "turno" con 5 assertions → PASSED persistido; caso mal planteado → FAILED con diagnóstico del recorrido real; corregido → PASSED | ✅ |
| E2E rama "turno": WhatsApp sim → variable → condición true → respuesta personalizada con `{{trigger.name}}` y `{{variables.empresa}}` | ✅ |
| E2E rama "general": condición false → respuesta general | ✅ |
| E2E webhook público: `POST /hooks/:token` → 202 → worker → SUCCEEDED; token inválido → 404 | ✅ |
| Migración `workflow_webhook_token` con backfill sobre datos existentes | ✅ |
| Builds de producción (packages, api, worker, web) | ✅ |
| Migración `init` + seed sobre Postgres real | ✅ |
| E2E por API: dev-login → cookie → listar proyectos → **ejecutar flujo demo** → worker lo procesa → 3 pasos SUCCEEDED con input/output correctos → salida final `{"message":"Hola Hola, quiero un turno"}` | ✅ |
| E2E: reintentar ejecución → nueva ejecución SUCCEEDED | ✅ |
| Web en http://localhost:3005 con login funcional | ✅ (puerto 3000 ocupado por otro proceso local) |

## Problemas encontrados y resueltos

- **Trigger por categoría**: `isTrigger` solo reconocía la categoría `trigger`, y el nodo de WhatsApp vive en la categoría `whatsapp` → el flujo demo fallaba con NO_TRIGGER. Semántica corregida: disparador = nodo sin puertos de entrada (registry + motor alineados).
- **Procesos zombis**: quedaron 5 `node dist/main.js` acumulados de reinicios anteriores (workers viejos consumían la cola con código desactualizado). Limpiados; el patrón de kill ahora matchea el comando real.
- **Migración con backfill**: agregar `webhookToken NOT NULL` sobre filas existentes requirió migración manual (ADD NULL → UPDATE → SET NOT NULL → UNIQUE), y el timestamp del folder debe ser UTC posterior al de `init` (la shadow DB aplica en orden de nombre).
- **Bug real detectado en E2E**: el trigger manual devolvía el input vacío `{}` en lugar del payload de ejemplo, y `{{trigger.*}}` apuntaba al dato crudo en vez de a la salida del trigger. Corregidos ambos (nodo y motor) y re-verificado E2E.
- Timeout global del motor: no interrumpía un nodo en curso; ahora el timeout de cada nodo se acota al presupuesto global restante (test lo cubre).
- Tipos BullMQ/ioredis: se pasa configuración plana (`redisConnectionFromUrl`) en vez de instancias, evitando choques de versión.
- Sin Docker en la máquina: se instaló PostgreSQL 16 + Redis 7 vía Homebrew (`brew services`); el compose queda para entornos con Docker.

## Decisiones pendientes

- Credenciales Google OAuth reales + `AUTHORIZED_EMAILS` del equipo.
- SSE para reemplazar el polling del builder (Fase 4).
- Nombrar y ejecutar los próximos nodos del MVP (webhook, condición, switch, set variable, esperar) — Fase 4 de nodos.

## Próxima fase

**Fase 5 (Simulador de WhatsApp/webhook)** y completar Fase 4 (SSE, ejecución desde nodo, comparar ejecuciones), luego casos de prueba (Fase 6).
