# IF Nodes — Handoff técnico

Estado del proyecto, fases realizadas y qué queda. Complemento práctico: [USER_GUIDE.md](USER_GUIDE.md).

Repositorio: https://github.com/Nacho234/IF-Nodes · Local: `~/if-nodes` · Última actualización: 2026-07-15.

> **¿Sos Nico y arrancás ahora?** Leé primero la **§8 (Continuación 2026-07-15)** al final: ahí está todo lo nuevo (IF Copilot, nodos de agentes avanzados, Opción B / export de proyecto completo, y el estado del cliente FePI). Las §1–§7 son la base histórica.

---

## 1. Qué es

Herramienta **interna** del equipo para crear, probar, depurar y **exportar** bots y automatizaciones con un constructor visual de nodos. No es un SaaS público. Cada proyecto termina como un **runtime independiente y liviano** que se despliega en Railway/VPS.

```
Crear cliente → proyecto → diseñar flujo con nodos → configurar integraciones
→ simular → depurar → casos de prueba → versión estable → EXPORTAR runtime → deploy
```

Principio central: **el builder y el runtime están separados**, pero comparten el mismo motor (`workflow-core`) y las mismas definiciones de nodos. Lo que probás en el builder es exactamente lo que corre en producción.

---

## 2. Stack y estructura

Monorepo **npm workspaces**, TypeScript estricto en todo.

```
apps/
  web/     Next.js 15 (App Router) + Tailwind v4 + React Flow — la UI del builder
  api/     NestJS 11 + Prisma — auth, clientes, proyectos, flujos, ejecuciones, etc.
  worker/  Consumidor BullMQ — ejecuta los flujos (nunca en el request HTTP)
packages/
  shared/            Tipos, esquema Zod del grafo, permisos, marca, crypto, SSRF, plantillas
  database/          Prisma schema + cliente + seed
  node-definitions/  Contrato de nodos + registro + los 12 nodos + parser/envío WhatsApp
  workflow-core/     Motor de ejecución PURO (sin IO): grafo, ramas, errores, reintentos
  expression-engine/ Parser seguro de {{expresiones}} (sin eval)
  runtime-template/  Runtime genérico que se empaqueta en cada export
docker/    docker-compose (Postgres + Redis)
```

Infra local: PostgreSQL 16 + Redis 7 (por `brew services` en esta máquina; el `docker-compose` queda para otras). Auth: Google OAuth + **dev-login** controlado (solo fuera de producción) con allowlist `AUTHORIZED_EMAILS`.

---

## 3. Fases realizadas (todas verificadas E2E)

| Fase | Qué se hizo | Estado |
|---|---|---|
| **1. Fundaciones** | Monorepo, Docker/infra, Prisma (17 modelos), auth (Google + dev-login, sesiones en DB, CSRF), roles (Owner/Developer/Tester/Viewer), clientes, proyectos, layout dark-first | ✅ |
| **2. Constructor visual** | React Flow: agregar/conectar/mover/eliminar nodos, biblioteca con buscador, panel de config generado desde el nodo, autosave, validación, undo/redo, copiar/pegar, notas | ✅ |
| **3. Motor** | `expression-engine` (parser sin eval), `workflow-core` (validación de grafo, ramas por puertos, 5 estrategias de error, reintentos con backoff, timeouts, cancelación, límites), worker BullMQ, ejecuciones con historial por paso | ✅ |
| **4. Debugging** | Botón Ejecutar con nodos iluminándose en vivo, página global de Ejecuciones, detalle por nodo (entrada/salida/error/logs), reintentar | ✅ (SSE pendiente; hoy polling) |
| **5. Simulador** | Chat de WhatsApp en el constructor: cada mensaje ejecuta el flujo real y muestra la respuesta; webhook público `POST /hooks/:token` | ✅ |
| **6. Casos de prueba** | Guardar entradas como casos, 9 tipos de assertions (igual/contiene/existe/nodo visitado/estado final…), ejecutar uno o todos, diff del resultado | ✅ |
| **7. Integraciones** | Credenciales cifradas (AES-256-GCM, 9 tipos, prueba de conexión real), nodo HTTP con **protección SSRF**, nodos de IA (dev-echo/Anthropic/OpenAI) con registro de uso, variables por entorno | ✅ |
| **8. Versionado** | Publicar versiones inmutables, marcar estable, comparar (diff de grafos), restaurar | ✅ |
| **9. Exportador** | Runtime genérico empaquetado con esbuild (~130 KB autocontenido, 0 deps del monorepo); genera workflow.json + manifest + Dockerfile + railway.json + .env.example + README; ZIP descargable; secretos → variables de entorno (no se filtran) | ✅ |
| **10. Calidad** | Variables por entorno (UI), tests E2E Playwright, Configuración (equipo/roles), Plantillas (4 iniciales), **WhatsApp de punta a punta** (envío real + parser de Meta), borrar proyectos/clientes | ✅ parcial |

**Nodos disponibles (24 — ver §8 para los avanzados):** triggers `manual`, `webhook`, `whatsapp-message`, `schedule` (cron), `campaign-contact`; lógica `condition`, `switch`, `set-variable`, `wait`; datos `transform`; IA `generate`, `classify`, `agent` (tool-calling), `knowledge-search` (RAG); memoria `load-history`, `save-turn`; contactos `upsert`, `find`; comunicación `respond`, `send-email`, `escalate` (handoff); WhatsApp `send-text`; HTTP `http-request`; integraciones `google-calendar`.

---

## 4. Verificación

- **~110 tests unitarios** (motor, nodos, expresiones, assertions, SSRF, diff, plantillas, parser WhatsApp) + **7 tests E2E Playwright** del recorrido principal.
- Comandos: `npm run typecheck` · `npm run lint` · `npm run test` (todos limpios) · `npm run test:e2e -w @ifnodes/web` (requiere el stack corriendo).
- El exportador se verificó corriendo el runtime **standalone fuera del repo, sin `node_modules`**: `/health` responde, `POST /run` ejecuta el flujo, `POST /webhooks/whatsapp` parsea el payload real de Meta.
- Seguridad verificada: los secretos se guardan cifrados y no aparecen en los exports; SSRF bloquea IPs internas/metadata; sesiones HttpOnly + CSRF.

---

## 5. Bug notable corregido

El constructor entraba en un **bucle infinito de renders** al abrirse en un navegador (nunca se había abierto en uno real, solo se ejecutaba por API). Lo cazó el test E2E de Playwright. Causa: un selector de Zustand devolvía un array nuevo por render + `onSelectionChange` de React Flow re-seteaba el mismo valor. Corregido.

---

## 6. Qué falta (priorizado)

> ⚠️ **Parcialmente superado por la §8** (2026-07-15): contactos/CRM, memoria, cron,
> nodo Esperar, SMTP y RAG **ya están hechos**. Ver §8.7 para lo que realmente queda.

**Operacional (config, no código):**
- Desplegar el builder (web+api+worker) en un servidor. Los Dockerfiles/compose están; falta verificar `docker build` (no hay Docker en la máquina de desarrollo).
- Google OAuth real (`GOOGLE_CLIENT_ID/SECRET`) para reemplazar el dev-login.
- Para bots de WhatsApp reales: cuenta de WhatsApp Cloud API (número + token de Meta).

**Funcional (según el tipo de bot):**
- Contactos / CRM (nodos crear/buscar/actualizar; el modelo `Contact` existe, faltan nodos y bandeja).
- Memoria de conversación entre mensajes (hoy cada mensaje es una ejecución independiente).
- Nodo Esperar y trigger programado (cron).
- Nodo SMTP (la credencial existe, falta el nodo); más nodos de WhatsApp (botones, lista, archivo).
- Subflujos y base de conocimiento (RAG).

**Pulido:**
- SSE en vivo (reemplazar el polling del debug), reportes reales de consumo de IA (los datos ya se registran en `UsageRecord`), accesibilidad (axe), grupos de nodos.
- Menor: el export lista `WHATSAPP_VERIFY_TOKEN` y `WHATSAPP_CLOUD_VERIFY_TOKEN` por separado (poner el mismo valor).

---

## 7. Cómo levantarlo

```bash
npm install
cp .env.example .env    # completar SESSION_SECRET, CREDENTIALS_ENCRYPTION_KEY (openssl rand -hex 32) y AUTHORIZED_EMAILS

# Postgres + Redis (con Docker):
npm run db:up
# Sin Docker (macOS): brew install postgresql@16 redis && brew services start postgresql@16 redis
#   psql -d postgres -c "CREATE ROLE ifnodes LOGIN PASSWORD 'ifnodes_dev' CREATEDB;" && createdb -O ifnodes ifnodes

npm run db:generate && npm run db:migrate && npm run db:seed
npm run build:packages

# En tres terminales:
npm run dev:api      # :3001
npm run dev:worker   # cola de ejecuciones
npm run dev:web      # :3000  (si está ocupado, usar --port 3005)
```

Entrar → login de desarrollo con un email de `AUTHORIZED_EMAILS`.

Documentación técnica adicional: `PROJECT_PLAN.md`, `ARCHITECTURE.md`, `WORKFLOW_ENGINE.md`, `NODE_DEVELOPMENT.md`, `EXPORT_RUNTIME.md`, `SECURITY.md`, `PROGRESS.md`, `AGENTES_AVANZADOS.md`.

---

## 8. Continuación (2026-07-15) — Copilot, agentes avanzados y Opción B

Todo lo de acá está commiteado (`e5851c2`). Es la capa que convierte a IF Nodes en un
constructor de **agentes conversacionales avanzados** que además **corren enteros en la
infra del cliente**. FePI es el primer cliente real y se usa como ejemplo (todo lo demás
es plataforma genérica).

### 8.1 IF Copilot (asistente de IA en el constructor)

Paquete nuevo `packages/copilot`. Un asistente que **arma y modifica los flujos** por vos.

- **Provider** (`provider.ts`): `ClaudeCopilotProvider` habla con la Messages API de
  Claude por **fetch SSE crudo** con tool-use (streaming). Fallback `DevCopilotProvider`
  sin API key. Fábrica `createCopilotProvider`.
- **Dos herramientas**: `propose_changes` (changeset de 4 ops: add_node / add_edge /
  update_config / delete_node, todo-o-nada) y `build_project` (arma un proyecto entero:
  varios flujos + conocimiento de un prompt de alto nivel).
- **Aplicar** (`apply.ts`): `applyChangeSet` es PURO, valida todo antes de tocar el grafo
  y corre **auto-layout** al final (nada de nodos encimados). En el front hay botón
  "Aplicar propuesta" con undo (⌘Z).
- **Contexto redactado** (`context.ts`): al Copilot se le manda el grafo + catálogo de
  nodos (con `outputVars` y `readiness`), **sin secretos** (`redactSecrets`). Los secretos
  NUNCA salen del backend.
- **API**: módulo `apps/api/src/copilot`, permiso `copilot.use`. Config por env:
  `COPILOT_PROVIDER / MODEL / ANTHROPIC_API_KEY / THINKING / MAX_TOKENS` (ver §8.6).
- **UI**: botón "Copilot" en la toolbar del constructor + "Generar con IA" en el detalle
  del proyecto (`build-project-button.tsx`).
- Modelo por defecto: `claude-opus-4-8`. **Sin API key → modo dev** (no gasta).

### 8.2 Nodos de agentes avanzados (plataforma)

Cada nodo que se registra, el Copilot lo empieza a usar solo (lee el registro). Todos
degradan a "simulado" sin credencial y son exportables. Roadmap y detalle en
`AGENTES_AVANZADOS.md`.

- **Memoria de conversación**: `memory.load-history` (devuelve `transcript` para el prompt)
  + `memory.save-turn`. Modelos `Conversation` + `ConversationMessage`. Aísla por contacto.
- **Agente IA con herramientas**: `ai.agent` — LLM en loop tool-calling (decide → ejecuta
  → ve resultado → sigue) hasta el objetivo o `maxSteps`. Built-in `http_request` (SSRF) y
  `get_conversation_history`, + tools HTTP a medida por config.
- **RAG / base de conocimiento**: `ai.knowledge-search` + `KnowledgeChunk`. Ranking por
  keyword (`rankKnowledge`, sin embeddings — mejora futura). El export emite `knowledge.json`.
- **Cron + esperar**: `trigger.schedule` (cron+timezone) y `logic.wait` (espera corta ≤60s).
- **Email/SMTP**: `communication.send-email` (nodemailer, credencial `smtp`).
- **Contactos/CRM**: `contacts.upsert` / `contacts.find` + modelo `Contact`
  (`@@unique([projectId,phone])` y `[projectId,email]`).
- **Handoff**: `communication.escalate` marca la conversación `handoff/closed/open`; el
  flujo branchea con `load-history.status` para no auto-responder cuando hay un humano.
- **Campañas/outreach**: `trigger.campaign-contact` + fan-out (una ejecución por contacto).
- **Google Calendar**: `integrations.google-calendar` (crea evento; auth = credencial
  http-bearer con access token OAuth — OAuth con refresh es futuro).
- **Readiness**: `analyzeReadiness` + botón "Puesta en marcha" (lista qué falta
  conectar/cargar) — y alimenta al Copilot para que te guíe.
- **Validador de expresiones**: `findExpressionIssues` (cazado en "Validar"): detecta
  `{{atajos}}` inválidos; la sintaxis correcta es SIEMPRE `{{nodes.<id>.output.<campo>}}`.

### 8.3 Opción B — el bot completo corre en el stack del cliente

Antes el export era de **un** flujo, sin DB. Ahora hay **export de proyecto completo**:

- **Endpoint**: `POST /projects/:id/export` (además del viejo `POST /workflows/:id/export`).
  Bundlea TODOS los flujos del proyecto en `workflow/flows.json` (usa la versión estable de
  cada flujo, o el borrador si no hay versión) + manifest/credenciales/knowledge combinados.
- **UI**: botón "Exportar bot" en el detalle del proyecto (`export-project-button.tsx`).
- **Runtime multi-flow** (`packages/runtime-template`): `main.ts` es un **orquestador** que
  lee `flows.json` (o el viejo `workflow.json`) y rutea:
  - `POST /run` (opcional `?flow=slug`) → flujo inbound (WhatsApp > webhook > manual)
  - `POST /webhooks/whatsapp` → flujo de WhatsApp (parser de Meta)
  - `POST /campaigns/run` → **fan-out por contacto** (lee contactos del store por filtro,
    corre el flujo de campaña escalonado; `dryRun` solo cuenta)
  - `GET /flows` → lista de flujos y triggers (visibilidad para operadores)
  - **Scheduler cron propio** (`cron.ts`, sin deps, con timezone) para los flujos
    `trigger.schedule`.
- **Persistencia** (`store.ts`): `InMemoryStore` (efímero, opción A) o `PostgresStore`
  (opción B — auto-crea tablas `ifn_conversations/ifn_messages/ifn_contacts`). Se elige con
  `RUNTIME_DATABASE_URL` / `DATABASE_URL`. Memoria + contactos **persisten en el Postgres/
  Supabase del cliente**. El conocimiento viaja en `knowledge.json`.
- El bundle sigue siendo **autocontenido** (esbuild, ~480 KB, 0 deps del monorepo).
  Verificado E2E: bootea, rutea, y hace campañas reales contra Postgres.

**Las 3 opciones de migración** (cada cliente elige): A) export efímero (memoria en el
proceso); B) todo en el stack del cliente con su DB (lo de arriba); C) lo hosteamos nosotros.

### 8.4 Estado del cliente FePI (ejemplo real)

Proyecto `cmri24svt0003f5ikd8qrbl26`. FePI = Festival Internacional de la Publicidad
Independiente (Fundación Comunicar), 20 años, para agencias **independientes** (excluye a
los "Big Six": Publicis/WPP/Omnicom/IPG/Dentsu/Havas). Quiere hostear todo en su stack → Opción B.

- **3 flujos** (todos validan 0 errores, personas con el tono real: coordinador/a de
  Producción, *invita no vende*, español neutro AR/CL/EC, "¡un abrazo!"):
  1. **Flujo principal** (WhatsApp): trigger → cargar historial → RAG → clasificar
     intención → si "reunion" escala a operador, si no responde con IA + envía + guarda turnos.
  2. **Campaña de outreach**: por contacto → RAG → mensaje inicial IA → si tiene teléfono
     WhatsApp / si no email → marca contactado. (Ruteo verificado: cubre solo-email.)
  3. **Seguimiento programado**: campaña de re-contacto (trigger `campaign-contact`; se
     lanza con `POST /campaigns/run?flow=seguimiento-programado`, **no** es cron).
- **Conocimiento**: 13 fragmentos reales anonimizados (qué es FePI, tono, 16 categorías,
  plazos/aranceles USD 340, quién puede/no, objeciones, plantillas). RAG verificado.
- **Contactos**: **2.030** reales importados al CRM desde los Excel del cliente (1.253 con
  email, 1.449 con teléfono; estado mapeado al pipeline). `{{trigger.name}}` = la **agencia**
  (así se importaron).
- **Datos en la DB, no en el repo** (son del cliente). Si Nico necesita reconstruirlos: los
  scripts de ingesta quedaron fuera del repo; el material original está en las carpetas de
  Drive del cliente.
- **Pendiente de FePI = setup EXTERNO del usuario**: plantillas **HSM** aprobadas por Meta
  (WhatsApp saliente masivo) + número de WhatsApp Cloud; **token OAuth de Google** (Calendar).
  Sin eso, todo corre en modo simulado.

### 8.5 Mapa de archivos nuevos clave

```
packages/copilot/src/            schemas · context · provider · apply · system-prompt
packages/runtime-template/src/   runtime(multi-flow) · main(orquestador) · store · cron · campaigns
packages/node-definitions/src/nodes/{memory,ai/agent,ai/knowledge-search,logic/wait,
                                 trigger/{schedule,campaign},communication/{send-email,escalate},
                                 contacts,integrations/google-calendar}
packages/node-definitions/src/{knowledge/rank, readiness, expression-check}.ts
apps/api/src/{copilot,knowledge,contacts,campaigns,conversations}/   controllers+services
apps/api/src/exports/            generator(multi-flow) · exports.service(generateProject)
apps/web/features/builder/       copilot-panel · readiness-dialog
apps/web/features/projects/      build-project-button · export-project-button
apps/web/app/(app)/projects/[id]/{contacts,knowledge,inbox}/        páginas
```

### 8.6 Variables de entorno nuevas

En `.env` (builder), además de las de §7:

```
ANTHROPIC_API_KEY=sk-ant-...     # Claude real para el Copilot y los nodos IA (paga)
COPILOT_PROVIDER=claude          # o "dev" (sin gasto)
COPILOT_MODEL=claude-opus-4-8
```

> ⚠️ **Seguridad**: la API key de Anthropic se rota si alguna vez se pega en un chat.
> Nunca la commitees (`.env` está en `.gitignore`). El modelo por defecto de los nodos IA
> ya es `claude-sonnet-4-6` (se retiró `sonnet-4-5`).

### 8.7 Qué sigue (sugerido para Nico)

- **Desplegar** el builder (web+api+worker) y verificar `docker build` (no había Docker en
  la máquina). Google OAuth real para reemplazar el dev-login.
- **Mejoras del agente**: enriquecer `ai.classify` de FePI (hoy `reunion,consulta`) para
  rutear objeciones (presupuesto/no-conoce/prioridades — el conocimiento ya las tiene);
  **embeddings** para el RAG (hoy keyword); **tool-calling real de OpenAI** (hoy solo Claude).
- **Runtime**: suspensión/reanudación de ejecuciones largas (hoy `wait` es ≤60s); panel de
  operadores dentro del runtime exportado (hoy la Bandeja vive en el builder).
- Correr el bot de FePI apenas el cliente tenga HSM + número de WhatsApp Cloud.

### 8.8 Verificación (estado actual)

- **~200 tests** unitarios en verde (copilot 23, node-definitions 67, runtime-template 18,
  shared 46, workflow-core 20, expression-engine 15, api…). `npm run test` limpio.
- Typecheck + lint limpios en todos los workspaces.
- Opción B verificada E2E con el bot real de FePI (bundle bootea, rutea inbound, hace
  campaña real contra Postgres).
