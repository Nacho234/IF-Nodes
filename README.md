# IF Nodes

Herramienta **interna** del equipo para crear, probar, depurar y **exportar** bots y automatizaciones con un constructor visual de nodos. No es un SaaS público.

```text
Crear proyecto → Diseñar flujo → Integraciones → Simular → Depurar
→ Versión estable → Exportar runtime → GitHub → Railway / VPS
```

Documentación: [PROJECT_PLAN](PROJECT_PLAN.md) · [ARCHITECTURE](ARCHITECTURE.md) · [WORKFLOW_ENGINE](WORKFLOW_ENGINE.md) · [NODE_DEVELOPMENT](NODE_DEVELOPMENT.md) · [EXPORT_RUNTIME](EXPORT_RUNTIME.md) · [SECURITY](SECURITY.md) · [PROGRESS](PROGRESS.md)

## Stack

Monorepo npm workspaces · TypeScript estricto · Next.js 15 + React Flow + Tailwind v4 (web) · NestJS 11 + Prisma + PostgreSQL (api) · Redis + BullMQ (motor, Fase 3) · Vitest.

```text
apps/web               UI del builder
apps/api               API (auth, clientes, proyectos, flujos)
packages/shared        Tipos, esquema Zod del grafo, permisos, marca
packages/database      Prisma schema + seed
packages/node-definitions  Contrato y registro de nodos
```

## Requisitos

- Node.js ≥ 20 (probado con v26)
- Docker Desktop (para PostgreSQL y Redis) — o Postgres 16 y Redis 7 nativos

## Puesta en marcha

```bash
# 1. Dependencias
npm install

# 2. Variables de entorno
cp .env.example .env
#    → completar SESSION_SECRET y CREDENTIALS_ENCRYPTION_KEY (openssl rand -hex 32)
#    → poner tu email en AUTHORIZED_EMAILS

# 3. Base de datos y Redis
npm run db:up            # docker compose up -d (postgres + redis)
#    Sin Docker: brew install postgresql@16 redis && brew services start postgresql@16 redis
#    y crear el rol/DB: psql -d postgres -c "CREATE ROLE ifnodes LOGIN PASSWORD 'ifnodes_dev' CREATEDB;" && createdb -O ifnodes ifnodes

# 4. Esquema y datos demo
npm run db:generate      # prisma generate
npm run db:migrate       # crea las tablas (pide nombre de migración)
npm run db:seed          # usuario owner + cliente y proyecto demo

# 5. Compilar los packages compartidos
npm run build:packages

# 6. Levantar (en tres terminales)
npm run dev:api          # http://localhost:3001
npm run dev:worker       # consumidor de la cola de ejecuciones
npm run dev:web          # http://localhost:3000
```

Entrar a http://localhost:3000 → **Ingreso de desarrollo** con tu email autorizado (mientras Google OAuth no esté configurado; ver abajo).

## Login con Google (opcional en dev, obligatorio en prod)

1. Google Cloud Console → Credentials → OAuth Client ID (tipo Web).
2. Redirect URI: `http://localhost:3001/auth/google/callback`.
3. Completar `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en `.env`.
4. En producción, `AUTH_DEV_LOGIN` se ignora siempre (ver [SECURITY.md](SECURITY.md)).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run typecheck` | TypeScript en todos los workspaces |
| `npm run lint` | ESLint en todos los workspaces |
| `npm run test` | Tests unitarios (Vitest) |
| `npm run build` | Build completo (packages → api → web) |
| `npm run db:studio -w @ifnodes/database` | Prisma Studio |

## Estado actual

Fases 1 y 2 completas y el núcleo de las Fases 3–4 operativo: constructor con autosave/undo/copy-paste/notas, motor de ejecución testeado (54 tests unitarios), worker BullMQ, ejecuciones con historial por paso y debugging en vivo desde el constructor. Simulador, casos de prueba, integraciones, versionado y exportador siguen el orden de fases de [PROJECT_PLAN.md](PROJECT_PLAN.md). Verificaciones al día en [PROGRESS.md](PROGRESS.md).
