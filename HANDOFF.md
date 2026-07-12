# IF Nodes — Handoff técnico

Estado del proyecto, fases realizadas y qué queda. Complemento práctico: [USER_GUIDE.md](USER_GUIDE.md).

Repositorio: https://github.com/Nacho234/IF-Nodes · Local: `~/if-nodes` · Última actualización: 2026-07-12.

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

**Nodos disponibles (12):** `trigger.manual`, `trigger.webhook`, `trigger.whatsapp-message`, `logic.condition`, `logic.switch`, `logic.set-variable`, `data.transform`, `ai.generate`, `ai.classify`, `integrations.http-request`, `whatsapp.send-text`, `communication.respond`.

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

Documentación técnica adicional: `PROJECT_PLAN.md`, `ARCHITECTURE.md`, `WORKFLOW_ENGINE.md`, `NODE_DEVELOPMENT.md`, `EXPORT_RUNTIME.md`, `SECURITY.md`, `PROGRESS.md`.
